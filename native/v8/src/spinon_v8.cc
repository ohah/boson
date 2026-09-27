#include "spinon_v8.h"

#include <libplatform/libplatform.h>
#include <v8.h>

#include <memory>
#include <mutex>
#include <string>

struct SpinonV8Runtime {
  v8::Isolate *isolate = nullptr;
  v8::ArrayBuffer::Allocator *allocator = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> event_handler;
  SpinonNodeCallback node_callback = nullptr;
  SpinonTextCallback text_callback = nullptr;
  void *user_data = nullptr;
  std::string error;
};

namespace {
std::once_flag platform_once;
std::unique_ptr<v8::Platform> platform;

void InitializeV8() {
  platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
}

void CreateNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<SpinonV8Runtime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 2 || !args[0]->IsInt32() || !args[1]->IsString()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "spinon.createNode(id, tag) requires an integer and a string"));
    return;
  }
  v8::String::Utf8Value tag(args.GetIsolate(), args[1]);
  if (runtime->node_callback) {
    runtime->node_callback(runtime->user_data,
                           args[0].As<v8::Int32>()->Value(), *tag ? *tag : "");
  }
}

void SetText(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<SpinonV8Runtime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 1 || !args[0]->IsString()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "spinon.setText(text) requires a string"));
    return;
  }
  v8::String::Utf8Value text(args.GetIsolate(), args[0]);
  if (runtime->text_callback) {
    runtime->text_callback(runtime->user_data, *text ? *text : "");
  }
}

void OnEvent(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<SpinonV8Runtime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 1 || !args[0]->IsFunction()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "spinon.onEvent(handler) requires a function"));
    return;
  }
  runtime->event_handler.Reset(args.GetIsolate(), args[0].As<v8::Function>());
}

std::string ExceptionText(v8::Isolate *isolate, v8::TryCatch &try_catch) {
  v8::String::Utf8Value text(isolate, try_catch.Exception());
  return *text ? *text : "unknown JavaScript error";
}

bool Enter(SpinonV8Runtime *runtime, v8::Local<v8::Context> *context) {
  if (!runtime || !runtime->isolate || runtime->context.IsEmpty()) return false;
  *context = runtime->context.Get(runtime->isolate);
  return !context->IsEmpty();
}
}  // namespace

extern "C" SpinonV8Runtime *spinon_v8_runtime_new(
    SpinonNodeCallback node_callback, SpinonTextCallback text_callback,
    void *user_data) {
  std::call_once(platform_once, InitializeV8);
  auto *runtime = new SpinonV8Runtime;
  runtime->node_callback = node_callback;
  runtime->text_callback = text_callback;
  runtime->user_data = user_data;

  v8::Isolate::CreateParams params;
  runtime->allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  params.array_buffer_allocator = runtime->allocator;
  runtime->isolate = v8::Isolate::New(params);
  if (!runtime->isolate) {
    delete runtime->allocator;
    delete runtime;
    return nullptr;
  }
  runtime->isolate->SetData(0, runtime);
  {
    v8::Isolate::Scope isolate_scope(runtime->isolate);
    v8::HandleScope handle_scope(runtime->isolate);
    auto global = v8::ObjectTemplate::New(runtime->isolate);
    auto spinon = v8::ObjectTemplate::New(runtime->isolate);
    spinon->Set(runtime->isolate, "createNode",
                 v8::FunctionTemplate::New(runtime->isolate, CreateNode));
    spinon->Set(runtime->isolate, "setText",
                 v8::FunctionTemplate::New(runtime->isolate, SetText));
    spinon->Set(runtime->isolate, "onEvent",
                 v8::FunctionTemplate::New(runtime->isolate, OnEvent));
    global->Set(runtime->isolate, "spinon", spinon);
    runtime->context.Reset(
        runtime->isolate, v8::Context::New(runtime->isolate, nullptr, global));
  }
  return runtime;
}

extern "C" int32_t spinon_v8_runtime_eval(SpinonV8Runtime *runtime,
                                            const char *source) {
  if (!runtime || !source) return -1;
  runtime->error.clear();
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope handle_scope(runtime->isolate);
  v8::Local<v8::Context> context;
  if (!Enter(runtime, &context)) return -1;
  v8::Context::Scope context_scope(context);
  v8::TryCatch try_catch(runtime->isolate);
  auto text = v8::String::NewFromUtf8(runtime->isolate, source);
  if (text.IsEmpty()) {
    runtime->error = "JavaScript source is not valid UTF-8";
    return -1;
  }
  v8::Local<v8::Script> script;
  if (!v8::Script::Compile(context, text.ToLocalChecked()).ToLocal(&script) ||
      script->Run(context).IsEmpty()) {
    runtime->error = ExceptionText(runtime->isolate, try_catch);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

extern "C" int32_t spinon_v8_runtime_dispatch(SpinonV8Runtime *runtime,
                                                 int32_t node_id) {
  if (!runtime) return -1;
  runtime->error.clear();
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope handle_scope(runtime->isolate);
  v8::Local<v8::Context> context;
  if (!Enter(runtime, &context)) return -1;
  v8::Context::Scope context_scope(context);
  if (runtime->event_handler.IsEmpty()) {
    runtime->error = "JavaScript registered no event handler";
    return -1;
  }
  v8::TryCatch try_catch(runtime->isolate);
  auto handler = runtime->event_handler.Get(runtime->isolate);
  v8::Local<v8::Value> arguments[] = {
      v8::Int32::New(runtime->isolate, node_id)};
  if (handler->Call(context, context->Global(), 1, arguments).IsEmpty()) {
    runtime->error = ExceptionText(runtime->isolate, try_catch);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

extern "C" const char *spinon_v8_runtime_last_error(
    SpinonV8Runtime *runtime) {
  return runtime ? runtime->error.c_str() : "null runtime";
}

extern "C" void spinon_v8_runtime_free(SpinonV8Runtime *runtime) {
  if (!runtime) return;
  runtime->event_handler.Reset();
  runtime->context.Reset();
  runtime->isolate->Dispose();
  delete runtime->allocator;
  delete runtime;
}
