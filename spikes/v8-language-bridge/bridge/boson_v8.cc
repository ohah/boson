#include "boson_v8.h"

#include <libplatform/libplatform.h>
#include <v8.h>

#include <memory>
#include <string>

struct BosonRuntime {
  v8::Isolate *isolate = nullptr;
  v8::ArrayBuffer::Allocator *allocator = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> event_handler;
  BosonNodeCallback callback = nullptr;
  void *user_data = nullptr;
  std::string error;
};

namespace {
std::unique_ptr<v8::Platform> platform;

void CreateNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<BosonRuntime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 2 || !args[0]->IsInt32() || !args[1]->IsString()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "createNode(id, tag) requires an integer and a string"));
    return;
  }
  v8::String::Utf8Value tag(args.GetIsolate(), args[1]);
  runtime->callback(runtime->user_data, args[0].As<v8::Int32>()->Value(), *tag);
}

void OnEvent(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<BosonRuntime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 1 || !args[0]->IsFunction()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "onEvent(handler) requires a function"));
    return;
  }
  runtime->event_handler.Reset(args.GetIsolate(), args[0].As<v8::Function>());
}

std::string ExceptionText(v8::Isolate *isolate, v8::TryCatch &try_catch) {
  v8::String::Utf8Value text(isolate, try_catch.Exception());
  return *text ? *text : "unknown JavaScript error";
}
}  // namespace

extern "C" BosonRuntime *boson_runtime_new(BosonNodeCallback callback,
                                              void *user_data) {
  if (!callback) return nullptr;
  if (!platform) {
    platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform.get());
    v8::V8::Initialize();
  }
  auto *runtime = new BosonRuntime;
  runtime->callback = callback;
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
    v8::HandleScope scope(runtime->isolate);
    auto global = v8::ObjectTemplate::New(runtime->isolate);
    auto boson = v8::ObjectTemplate::New(runtime->isolate);
    boson->Set(runtime->isolate, "createNode",
               v8::FunctionTemplate::New(runtime->isolate, CreateNode));
    boson->Set(runtime->isolate, "onEvent",
               v8::FunctionTemplate::New(runtime->isolate, OnEvent));
    global->Set(runtime->isolate, "boson", boson);
    runtime->context.Reset(runtime->isolate,
                           v8::Context::New(runtime->isolate, nullptr, global));
  }
  return runtime;
}

extern "C" int32_t boson_runtime_eval(BosonRuntime *runtime,
                                        const char *source) {
  if (!runtime || !source) return -1;
  runtime->error.clear();
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope scope(runtime->isolate);
  auto context = runtime->context.Get(runtime->isolate);
  v8::Context::Scope context_scope(context);
  v8::TryCatch try_catch(runtime->isolate);
  auto text = v8::String::NewFromUtf8(runtime->isolate, source);
  v8::Local<v8::Script> script;
  if (text.IsEmpty() || !v8::Script::Compile(context, text.ToLocalChecked())
                             .ToLocal(&script) ||
      script->Run(context).IsEmpty()) {
    runtime->error = ExceptionText(runtime->isolate, try_catch);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

extern "C" int32_t boson_runtime_dispatch(BosonRuntime *runtime,
                                            int32_t node_id) {
  if (!runtime) return -1;
  runtime->error.clear();
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope scope(runtime->isolate);
  auto context = runtime->context.Get(runtime->isolate);
  v8::Context::Scope context_scope(context);
  if (runtime->event_handler.IsEmpty()) {
    runtime->error = "no event handler registered";
    return -1;
  }
  v8::TryCatch try_catch(runtime->isolate);
  auto handler = runtime->event_handler.Get(runtime->isolate);
  v8::Local<v8::Value> arg[] = {v8::Int32::New(runtime->isolate, node_id)};
  if (handler->Call(context, context->Global(), 1, arg).IsEmpty()) {
    runtime->error = ExceptionText(runtime->isolate, try_catch);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

extern "C" const char *boson_runtime_last_error(BosonRuntime *runtime) {
  return runtime ? runtime->error.c_str() : "null runtime";
}

extern "C" void boson_runtime_free(BosonRuntime *runtime) {
  if (!runtime) return;
  runtime->event_handler.Reset();
  runtime->context.Reset();
  runtime->isolate->Dispose();
  delete runtime->allocator;
  delete runtime;
  // V8's process-wide platform remains initialized until process exit.
}
