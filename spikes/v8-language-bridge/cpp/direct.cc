#include <libplatform/libplatform.h>
#include <v8.h>

#include <cstdio>
#include <memory>

namespace {
v8::Global<v8::Function> event_handler;

void CreateNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  v8::String::Utf8Value tag(args.GetIsolate(), args[1]);
  std::printf("node=%d tag=%s\n", args[0].As<v8::Int32>()->Value(), *tag);
  std::fflush(stdout);
}

void OnEvent(const v8::FunctionCallbackInfo<v8::Value> &args) {
  event_handler.Reset(args.GetIsolate(), args[0].As<v8::Function>());
}
}  // namespace

extern "C" int boson_run() {
  auto platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
  auto *allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate::CreateParams params;
  params.array_buffer_allocator = allocator;
  auto *isolate = v8::Isolate::New(params);
  int result = 0;
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope scope(isolate);
    auto global = v8::ObjectTemplate::New(isolate);
    auto boson = v8::ObjectTemplate::New(isolate);
    boson->Set(isolate, "createNode", v8::FunctionTemplate::New(isolate, CreateNode));
    boson->Set(isolate, "onEvent", v8::FunctionTemplate::New(isolate, OnEvent));
    global->Set(isolate, "boson", boson);
    auto context = v8::Context::New(isolate, nullptr, global);
    v8::Context::Scope context_scope(context);
    v8::TryCatch try_catch(isolate);
    auto source = v8::String::NewFromUtf8Literal(
        isolate, "boson.createNode(1, 'view');"
                 "boson.onEvent(id => boson.createNode(id + 1, 'text'));");
    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(context, source).ToLocal(&script) ||
        script->Run(context).IsEmpty()) {
      result = 1;
    } else {
      auto handler = event_handler.Get(isolate);
      v8::Local<v8::Value> arg[] = {v8::Int32::New(isolate, 1)};
      if (handler->Call(context, context->Global(), 1, arg).IsEmpty()) result = 1;
    }
    if (result != 0) {
      v8::String::Utf8Value error(isolate, try_catch.Exception());
      std::fprintf(stderr, "%s\n", *error ? *error : "V8 error");
    }
    event_handler.Reset();
  }
  isolate->Dispose();
  delete allocator;
  return result;
}

#ifndef BOSON_NO_MAIN
int main() { return boson_run(); }
#endif
