#include <android/log.h>
#include <jni.h>
#include <libplatform/libplatform.h>
#include <v8.h>

#include <memory>
#include <string>

extern "C" {
void *boson_tree_new();
void boson_tree_free(void *tree);
int boson_tree_create(void *tree, int id, int parent, const char *tag, int order);
int boson_tree_remove(void *tree, int id);
int boson_tree_set_text(void *tree, int id, const char *text);
int boson_tree_set_style(void *tree, int id, int width, int height,
                         int padding, int gap, int grow);
using FrameCallback = void (*)(void *, int, const char *, const char *, int, int, int, int);
int boson_tree_layout(const void *tree, int width, int height,
                      FrameCallback callback, void *user_data);
}

namespace {
struct Runtime {
  void *tree = nullptr;
  v8::Isolate *isolate = nullptr;
  v8::ArrayBuffer::Allocator *allocator = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> handler;
  std::string error;
};

std::unique_ptr<v8::Platform> platform;

void Fail(const v8::FunctionCallbackInfo<v8::Value> &args, const char *message) {
  args.GetIsolate()->ThrowException(v8::Exception::TypeError(
      v8::String::NewFromUtf8(args.GetIsolate(), message).ToLocalChecked()));
}

bool GetInt(v8::Local<v8::Context> context, v8::Local<v8::Object> object,
            const char *key, int fallback, int *value) {
  auto isolate = v8::Isolate::GetCurrent();
  v8::Local<v8::Value> item;
  if (!object->Get(context, v8::String::NewFromUtf8(isolate, key).ToLocalChecked()).ToLocal(&item)) return false;
  if (item->IsUndefined()) { *value = fallback; return true; }
  if (!item->IsInt32()) return false;
  *value = item.As<v8::Int32>()->Value();
  return true;
}

void CreateNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 4 || !args[0]->IsInt32() || !args[1]->IsInt32() ||
      !args[2]->IsString() || !args[3]->IsInt32()) {
    Fail(args, "createNode(id, parent, tag, order) expects integer, integer, string, integer");
    return;
  }
  auto *runtime = static_cast<Runtime *>(args.GetIsolate()->GetData(0));
  v8::String::Utf8Value tag(args.GetIsolate(), args[2]);
  if (boson_tree_create(runtime->tree, args[0].As<v8::Int32>()->Value(),
                        args[1].As<v8::Int32>()->Value(), *tag,
                        args[3].As<v8::Int32>()->Value()) != 0) {
    Fail(args, "createNode: duplicate ID, missing parent, or unsupported tag");
  }
}

void RemoveNode(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 1 || !args[0]->IsInt32()) { Fail(args, "removeNode(id) expects an integer"); return; }
  auto *runtime = static_cast<Runtime *>(args.GetIsolate()->GetData(0));
  if (boson_tree_remove(runtime->tree, args[0].As<v8::Int32>()->Value()) != 0)
    Fail(args, "removeNode: unknown ID");
}

void SetText(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 2 || !args[0]->IsInt32() || !args[1]->IsString()) {
    Fail(args, "setText(id, text) expects integer and string"); return;
  }
  auto *runtime = static_cast<Runtime *>(args.GetIsolate()->GetData(0));
  v8::String::Utf8Value text(args.GetIsolate(), args[1]);
  if (boson_tree_set_text(runtime->tree, args[0].As<v8::Int32>()->Value(), *text) != 0)
    Fail(args, "setText: unknown ID");
}

void SetStyle(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 2 || !args[0]->IsInt32() || !args[1]->IsObject()) {
    Fail(args, "setStyle(id, style) expects integer and object"); return;
  }
  auto context = args.GetIsolate()->GetCurrentContext();
  auto style = args[1].As<v8::Object>();
  int width, height, padding, gap, grow;
  if (!GetInt(context, style, "width", -1, &width) ||
      !GetInt(context, style, "height", -1, &height) ||
      !GetInt(context, style, "padding", 0, &padding) ||
      !GetInt(context, style, "gap", 0, &gap) ||
      !GetInt(context, style, "flexGrow", 0, &grow)) {
    Fail(args, "setStyle: width, height, padding, gap and flexGrow must be integers"); return;
  }
  auto *runtime = static_cast<Runtime *>(args.GetIsolate()->GetData(0));
  if (boson_tree_set_style(runtime->tree, args[0].As<v8::Int32>()->Value(),
                           width, height, padding, gap, grow) != 0)
    Fail(args, "setStyle: invalid ID or value");
}

void OnEvent(const v8::FunctionCallbackInfo<v8::Value> &args) {
  if (args.Length() != 1 || !args[0]->IsFunction()) { Fail(args, "onEvent(handler) expects function"); return; }
  auto *runtime = static_cast<Runtime *>(args.GetIsolate()->GetData(0));
  runtime->handler.Reset(args.GetIsolate(), args[0].As<v8::Function>());
}

std::string ErrorText(v8::Isolate *isolate, v8::TryCatch &caught) {
  v8::String::Utf8Value value(isolate, caught.Exception());
  return *value ? *value : "unknown JavaScript error";
}

void Free(Runtime *runtime) {
  if (!runtime) return;
  runtime->handler.Reset();
  runtime->context.Reset();
  if (runtime->isolate) runtime->isolate->Dispose();
  delete runtime->allocator;
  boson_tree_free(runtime->tree);
  delete runtime;
}

Runtime *New(const char *source) {
  if (!source) return nullptr;
  if (!platform) {
    platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform.get());
    v8::V8::Initialize();
  }
  auto *runtime = new Runtime;
  runtime->tree = boson_tree_new();
  runtime->allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate::CreateParams params;
  params.array_buffer_allocator = runtime->allocator;
  runtime->isolate = v8::Isolate::New(params);
  if (!runtime->tree || !runtime->isolate) { Free(runtime); return nullptr; }
  runtime->isolate->SetData(0, runtime);
  bool success = false;
  {
    v8::Isolate::Scope isolate_scope(runtime->isolate);
    v8::HandleScope scope(runtime->isolate);
    auto global = v8::ObjectTemplate::New(runtime->isolate);
    auto boson = v8::ObjectTemplate::New(runtime->isolate);
    boson->Set(runtime->isolate, "createNode", v8::FunctionTemplate::New(runtime->isolate, CreateNode));
    boson->Set(runtime->isolate, "removeNode", v8::FunctionTemplate::New(runtime->isolate, RemoveNode));
    boson->Set(runtime->isolate, "setText", v8::FunctionTemplate::New(runtime->isolate, SetText));
    boson->Set(runtime->isolate, "setStyle", v8::FunctionTemplate::New(runtime->isolate, SetStyle));
    boson->Set(runtime->isolate, "onEvent", v8::FunctionTemplate::New(runtime->isolate, OnEvent));
    global->Set(runtime->isolate, "boson", boson);
    auto context = v8::Context::New(runtime->isolate, nullptr, global);
    runtime->context.Reset(runtime->isolate, context);
    v8::Context::Scope context_scope(context);
    v8::TryCatch caught(runtime->isolate);
    auto script_source = v8::String::NewFromUtf8(runtime->isolate, source);
    v8::Local<v8::Script> script;
    success = !script_source.IsEmpty() &&
      v8::Script::Compile(context, script_source.ToLocalChecked()).ToLocal(&script) &&
      !script->Run(context).IsEmpty();
    if (!success) runtime->error = ErrorText(runtime->isolate, caught);
  }
  if (!success) {
    __android_log_print(ANDROID_LOG_ERROR, "BosonTree", "BOSON_JS_ERROR=%s", runtime->error.c_str());
    Free(runtime);
    return nullptr;
  }
  return runtime;
}

int Dispatch(Runtime *runtime, int id) {
  if (!runtime || runtime->handler.IsEmpty()) return -1;
  v8::Isolate::Scope isolate_scope(runtime->isolate);
  v8::HandleScope scope(runtime->isolate);
  auto context = runtime->context.Get(runtime->isolate);
  v8::Context::Scope context_scope(context);
  v8::TryCatch caught(runtime->isolate);
  auto handler = runtime->handler.Get(runtime->isolate);
  v8::Local<v8::Value> args[] = {v8::Int32::New(runtime->isolate, id)};
  if (handler->Call(context, context->Global(), 1, args).IsEmpty()) {
    runtime->error = ErrorText(runtime->isolate, caught);
    return -1;
  }
  runtime->isolate->PerformMicrotaskCheckpoint();
  return 0;
}

struct RenderContext { JNIEnv *env; jobject activity; jmethodID upsert; };

void OnFrame(void *value, int id, const char *tag, const char *text,
             int x, int y, int width, int height) {
  auto *ctx = static_cast<RenderContext *>(value);
  jstring java_tag = ctx->env->NewStringUTF(tag);
  jstring java_text = ctx->env->NewStringUTF(text);
  ctx->env->CallVoidMethod(ctx->activity, ctx->upsert, id, java_tag, java_text,
                           x, y, width, height);
  ctx->env->DeleteLocalRef(java_tag);
  ctx->env->DeleteLocalRef(java_text);
}

int Render(JNIEnv *env, jobject activity, Runtime *runtime, int width, int height) {
  jclass cls = env->GetObjectClass(activity);
  auto begin = env->GetMethodID(cls, "beginFrame", "()V");
  auto upsert = env->GetMethodID(cls, "upsertNode", "(ILjava/lang/String;Ljava/lang/String;IIII)V");
  auto end = env->GetMethodID(cls, "endFrame", "()V");
  env->CallVoidMethod(activity, begin);
  RenderContext ctx{env, activity, upsert};
  int result = boson_tree_layout(runtime->tree, width, height, OnFrame, &ctx);
  env->CallVoidMethod(activity, end);
  env->DeleteLocalRef(cls);
  return result;
}
}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_dev_boson_tree_TreeActivity_nativeCreate(JNIEnv *env, jobject activity,
                                               jstring source, jint width, jint height) {
  if (!source) return 0;
  const char *code = env->GetStringUTFChars(source, nullptr);
  Runtime *runtime = New(code);
  env->ReleaseStringUTFChars(source, code);
  if (!runtime) return 0;
  if (Render(env, activity, runtime, width, height) != 0) { Free(runtime); return 0; }
  return reinterpret_cast<jlong>(runtime);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_boson_tree_TreeActivity_nativeTap(JNIEnv *env, jobject activity,
                                            jlong handle, jint id, jint width, jint height) {
  auto *runtime = reinterpret_cast<Runtime *>(handle);
  int result = Dispatch(runtime, id);
  if (result == 0) result = Render(env, activity, runtime, width, height);
  if (result != 0)
    __android_log_print(ANDROID_LOG_ERROR, "BosonTree", "BOSON_JS_ERROR=%s", runtime->error.c_str());
  return result;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_boson_tree_TreeActivity_nativeDestroy(JNIEnv *, jobject, jlong handle) {
  Free(reinterpret_cast<Runtime *>(handle));
}
