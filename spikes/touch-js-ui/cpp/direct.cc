#include "boson_touch.h"

#include <libplatform/libplatform.h>
#include <v8.h>

#include <cstdio>
#include <memory>
#include <string>

namespace {
struct TouchRuntime {
  v8::Isolate *isolate = nullptr;
  v8::ArrayBuffer::Allocator *allocator = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> handler;
  BosonTouchTextCallback callback = nullptr;
  void *user_data = nullptr;
  std::string error;
};

std::unique_ptr<v8::Platform> platform;

void CreateNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 2 || !args[0]->IsInt32() || !args[1]->IsString()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "createNode(id, tag) requires an integer and a string"));
    return;
  }
  v8::String::Utf8Value tag(args.GetIsolate(), args[1]);
  std::printf("node=%d tag=%s\n", args[0].As<v8::Int32>()->Value(), *tag);
  std::fflush(stdout);
}

void OnEvent(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<TouchRuntime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 1 || !args[0]->IsFunction()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "onEvent(handler) requires a function"));
    return;
  }
  runtime->handler.Reset(args.GetIsolate(), args[0].As<v8::Function>());
}

void SetText(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<TouchRuntime *>(args.GetIsolate()->GetData(0));
  if (args.Length() != 1 || !args[0]->IsString()) {
    args.GetIsolate()->ThrowException(v8::String::NewFromUtf8Literal(
        args.GetIsolate(), "setText(text) requires a string"));
    return;
  }
  v8::String::Utf8Value text(args.GetIsolate(), args[0]);
  runtime->callback(runtime->user_data, *text);
}

std::string ExceptionText(v8::Isolate *isolate, v8::TryCatch &try_catch) {
  v8::String::Utf8Value text(isolate, try_catch.Exception());
  return *text ? *text : "unknown JavaScript error";
}
}

extern "C" void *boson_touch_new(const char *source,
                                   BosonTouchTextCallback callback,
                                   void *user_data) {
  if (!source || !callback) return nullptr;
  if (!platform) {
    platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform.get());
    v8::V8::Initialize();
  }

  auto *runtime = new TouchRuntime;
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
  bool success = false;
  {
    v8::Isolate::Scope isolate_scope(runtime->isolate);
    v8::HandleScope scope(runtime->isolate);
    auto global = v8::ObjectTemplate::New(runtime->isolate);
    auto boson = v8::ObjectTemplate::New(runtime->isolate);
    boson->Set(runtime->isolate, "createNode",
               v8::FunctionTemplate::New(runtime->isolate, CreateNode));
    boson->Set(runtime->isolate, "onEvent",
               v8::FunctionTemplate::New(runtime->isolate, OnEvent));
    boson->Set(runtime->isolate, "setText",
               v8::FunctionTemplate::New(runtime->isolate, SetText));
    global->Set(runtime->isolate, "boson", boson);
    auto context = v8::Context::New(runtime->isolate, nullptr, global);
    runtime->context.Reset(runtime->isolate, context);
    v8::Context::Scope context_scope(context);
    v8::TryCatch try_catch(runtime->isolate);
    auto text = v8::String::NewFromUtf8(runtime->isolate, source);
    v8::Local<v8::Script> script;
    success = !text.IsEmpty() &&
              v8::Script::Compile(context, text.ToLocalChecked()).ToLocal(&script) &&
              !script->Run(context).IsEmpty();
    if (!success) runtime->error = ExceptionText(runtime->isolate, try_catch);
    runtime->isolate->PerformMicrotaskCheckpoint();
  }
  if (!success) {
    std::fprintf(stderr, "JS: %s\n", runtime->error.c_str());
    boson_touch_free(runtime);
    return nullptr;
  }
  return runtime;
}

extern "C" int32_t boson_touch_dispatch(void *handle, int32_t node_id) {
  auto *runtime = static_cast<TouchRuntime *>(handle);
  if (!runtime) return -1;
  runtime->error.clear();
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope scope(runtime->isolate);
  auto context = runtime->context.Get(runtime->isolate);
  v8::Context::Scope context_scope(context);
  if (runtime->handler.IsEmpty()) {
    runtime->error = "no event handler registered";
    return -1;
  }
  v8::TryCatch try_catch(runtime->isolate);
  auto handler = runtime->handler.Get(runtime->isolate);
  v8::Local<v8::Value> arg[] = {v8::Int32::New(runtime->isolate, node_id)};
  if (handler->Call(context, context->Global(), 1, arg).IsEmpty()) {
    runtime->error = ExceptionText(runtime->isolate, try_catch);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

extern "C" const char *boson_touch_last_error(void *handle) {
  auto *runtime = static_cast<TouchRuntime *>(handle);
  return runtime ? runtime->error.c_str() : "null runtime";
}

extern "C" void boson_touch_free(void *handle) {
  auto *runtime = static_cast<TouchRuntime *>(handle);
  if (!runtime) return;
  runtime->handler.Reset();
  runtime->context.Reset();
  runtime->isolate->Dispose();
  delete runtime->allocator;
  delete runtime;
}
