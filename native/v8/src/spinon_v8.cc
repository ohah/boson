#include "spinon_v8.h"

#include <libplatform/libplatform.h>
#include <v8.h>

#include <memory>
#include <mutex>
#include <string>
#include <vector>

#if defined(__ANDROID__) || defined(__linux__)
#include <sys/syscall.h>
#include <unistd.h>
#elif defined(__APPLE__)
#include <pthread.h>
#endif

struct SpinonV8Runtime {
  v8::Isolate *isolate = nullptr;
  v8::ArrayBuffer::Allocator *allocator = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> event_handler;
  SpinonNodeCallback node_callback = nullptr;
  SpinonTextCallback text_callback = nullptr;
  SpinonDocumentCommitCallback document_commit_callback = nullptr;
  void *user_data = nullptr;
  void *document_user_data = nullptr;
  std::string error;
  bool was_terminated = false;
  bool document_commit_active = false;
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

struct OwnedDocumentOperation {
  SpinonDocumentOperation raw{};
  std::vector<uint16_t> namespace_utf16;
  std::vector<uint16_t> name_utf16;
  std::vector<uint16_t> value_utf16;
};

constexpr size_t kMaximumDocumentOperations = 256;
constexpr size_t kMaximumBatchStringUnits = 1'048'576;
constexpr int kMaximumNameUnits = 1024;
constexpr int kMaximumValueUnits = 1'048'576;
constexpr int kMaximumOperationTypeUnits = 32;
constexpr char16_t kHtmlNamespace[] = u"http://www.w3.org/1999/xhtml";

class ScopedBoolean {
 public:
  explicit ScopedBoolean(bool *value) : value_(value) { *value_ = true; }
  ~ScopedBoolean() { *value_ = false; }
  ScopedBoolean(const ScopedBoolean &) = delete;
  ScopedBoolean &operator=(const ScopedBoolean &) = delete;

 private:
  bool *value_;
};

bool ReadProperty(v8::Isolate *isolate, v8::Local<v8::Context> context,
                  v8::Local<v8::Object> object,
                  const char *name, v8::Local<v8::Value> *value) {
  v8::Local<v8::String> key = v8::String::NewFromUtf8(
                                  isolate, name, v8::NewStringType::kNormal)
                                  .ToLocalChecked();
  return object->Get(context, key).ToLocal(value);
}

bool ReadRequiredInt32(v8::Isolate *isolate, v8::Local<v8::Context> context,
                       v8::Local<v8::Object> object, const char *name,
                       int32_t *result) {
  v8::Local<v8::Value> value;
  if (!ReadProperty(isolate, context, object, name, &value) || !value->IsInt32())
    return false;
  *result = value.As<v8::Int32>()->Value();
  return true;
}

bool ReadRequiredString(v8::Isolate *isolate, v8::Local<v8::Context> context,
                        v8::Local<v8::Object> object, const char *name,
                        int maximum_units, std::vector<uint16_t> *result) {
  v8::Local<v8::Value> value;
  if (!ReadProperty(isolate, context, object, name, &value) ||
      !value->IsString())
    return false;
  v8::Local<v8::String> string = value.As<v8::String>();
  const int length = string->Length();
  if (length < 0 || length > maximum_units) return false;
  result->resize(static_cast<size_t>(length));
  if (length > 0) {
    string->Write(isolate, 0, static_cast<uint32_t>(length), result->data());
  }
  return true;
}

bool ReadOptionalNamespace(v8::Isolate *isolate,
                           v8::Local<v8::Context> context,
                           v8::Local<v8::Object> object,
                           std::vector<uint16_t> *result) {
  v8::Local<v8::Value> value;
  if (!ReadProperty(isolate, context, object, "namespace", &value))
    return false;
  if (value->IsUndefined()) {
    result->reserve(sizeof(kHtmlNamespace) / sizeof(kHtmlNamespace[0]) - 1);
    for (size_t index = 0;
         index < sizeof(kHtmlNamespace) / sizeof(kHtmlNamespace[0]) - 1;
         ++index) {
      result->push_back(static_cast<uint16_t>(kHtmlNamespace[index]));
    }
    return true;
  }
  if (!value->IsString()) return false;
  v8::Local<v8::String> string = value.As<v8::String>();
  const int length = string->Length();
  if (length < 0 || length > kMaximumNameUnits) return false;
  result->resize(static_cast<size_t>(length));
  if (length > 0) {
    string->Write(isolate, 0, static_cast<uint32_t>(length), result->data());
  }
  return true;
}

bool ReadOperationType(v8::Isolate *isolate, v8::Local<v8::Context> context,
                       v8::Local<v8::Object> object, std::string *result) {
  v8::Local<v8::Value> value;
  if (!ReadProperty(isolate, context, object, "type", &value) ||
      !value->IsString())
    return false;
  if (value.As<v8::String>()->Length() > kMaximumOperationTypeUnits)
    return false;
  v8::String::Utf8Value text(isolate, value);
  if (*text == nullptr) return false;
  result->assign(*text, static_cast<size_t>(text.length()));
  return true;
}

bool ParseDocumentOperation(v8::Isolate *isolate,
                            v8::Local<v8::Context> context,
                            v8::Local<v8::Value> value,
                            OwnedDocumentOperation *operation) {
  if (!value->IsObject() || value->IsNull() || value->IsArray()) return false;
  v8::Local<v8::Object> object = value.As<v8::Object>();
  std::string type;
  if (!ReadOperationType(isolate, context, object, &type)) return false;

  if (type == "createElement") {
    operation->raw.kind = 1;
    if (!ReadRequiredInt32(isolate, context, object, "id", &operation->raw.node_id) ||
        !ReadRequiredString(isolate, context, object, "name", kMaximumNameUnits,
                            &operation->name_utf16) ||
        !ReadOptionalNamespace(isolate, context, object,
                               &operation->namespace_utf16)) {
      return false;
    }
  } else if (type == "createText") {
    operation->raw.kind = 2;
    if (!ReadRequiredInt32(isolate, context, object, "id", &operation->raw.node_id) ||
        !ReadRequiredString(isolate, context, object, "data", kMaximumValueUnits,
                            &operation->value_utf16)) {
      return false;
    }
  } else if (type == "append") {
    operation->raw.kind = 3;
    if (!ReadRequiredInt32(isolate, context, object, "parent", &operation->raw.parent_id) ||
        !ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id)) {
      return false;
    }
  } else if (type == "insertBefore") {
    operation->raw.kind = 4;
    if (!ReadRequiredInt32(isolate, context, object, "parent", &operation->raw.parent_id) ||
        !ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id) ||
        !ReadRequiredInt32(isolate, context, object, "before", &operation->raw.before_id)) {
      return false;
    }
  } else if (type == "remove") {
    operation->raw.kind = 5;
    if (!ReadRequiredInt32(isolate, context, object, "parent", &operation->raw.parent_id) ||
        !ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id)) {
      return false;
    }
  } else if (type == "setText") {
    operation->raw.kind = 6;
    if (!ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id) ||
        !ReadRequiredString(isolate, context, object, "data", kMaximumValueUnits,
                            &operation->value_utf16)) {
      return false;
    }
  } else if (type == "setAttribute") {
    operation->raw.kind = 7;
    if (!ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id) ||
        !ReadRequiredString(isolate, context, object, "name", kMaximumNameUnits,
                            &operation->name_utf16) ||
        !ReadRequiredString(isolate, context, object, "value", kMaximumValueUnits,
                            &operation->value_utf16)) {
      return false;
    }
  } else if (type == "removeAttribute") {
    operation->raw.kind = 8;
    if (!ReadRequiredInt32(isolate, context, object, "node", &operation->raw.node_id) ||
        !ReadRequiredString(isolate, context, object, "name", kMaximumNameUnits,
                            &operation->name_utf16)) {
      return false;
    }
  } else {
    return false;
  }

  operation->raw.namespace_utf16 = operation->namespace_utf16.empty()
                                       ? nullptr
                                       : operation->namespace_utf16.data();
  operation->raw.namespace_length = operation->namespace_utf16.size();
  operation->raw.name_utf16 = operation->name_utf16.empty()
                                  ? nullptr
                                  : operation->name_utf16.data();
  operation->raw.name_length = operation->name_utf16.size();
  operation->raw.value_utf16 = operation->value_utf16.empty()
                                   ? nullptr
                                   : operation->value_utf16.data();
  operation->raw.value_length = operation->value_utf16.size();
  return true;
}

void ThrowDocumentError(v8::Isolate *isolate, const std::string &message,
                        bool type_error) {
  v8::Local<v8::String> text;
  if (!v8::String::NewFromUtf8(isolate, message.data(),
                               v8::NewStringType::kNormal,
                               static_cast<int>(message.size()))
           .ToLocal(&text)) {
    text = v8::String::NewFromUtf8Literal(isolate,
                                         "문서 변경 호출이 실패했습니다");
  }
  v8::Local<v8::Value> exception = type_error
                                      ? v8::Exception::TypeError(text)
                                      : v8::Exception::Error(text);
  isolate->ThrowException(exception);
}

void CommitDocumentBatch(const v8::FunctionCallbackInfo<v8::Value> &args) {
  auto *runtime = static_cast<SpinonV8Runtime *>(args.GetIsolate()->GetData(0));
  v8::Isolate *isolate = args.GetIsolate();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();
  if (runtime->document_commit_active) {
    ThrowDocumentError(isolate, "문서 변경 묶음은 중첩 호출할 수 없습니다", true);
    return;
  }
  ScopedBoolean active(&runtime->document_commit_active);
  v8::TryCatch try_catch(isolate);
  if (args.Length() != 1 || !args[0]->IsArray()) {
    ThrowDocumentError(isolate,
                       "commitDocumentBatch(operations)는 배열 하나를 받아야 합니다",
                       true);
    try_catch.ReThrow();
    return;
  }
  auto array = args[0].As<v8::Array>();
  const uint32_t operation_count = array->Length();
  if (operation_count > kMaximumDocumentOperations) {
    ThrowDocumentError(isolate,
                       "문서 변경 묶음은 최대 256개 작업까지 허용합니다",
                       true);
    try_catch.ReThrow();
    return;
  }

  std::vector<OwnedDocumentOperation> owned;
  owned.reserve(operation_count);
  size_t batch_string_units = 0;
  for (uint32_t index = 0; index < operation_count; ++index) {
    v8::Local<v8::Value> value;
    if (!array->Get(context, index).ToLocal(&value)) {
      try_catch.ReThrow();
      return;
    }
    OwnedDocumentOperation operation;
    if (!ParseDocumentOperation(isolate, context, value, &operation)) {
      if (try_catch.HasCaught()) {
        try_catch.ReThrow();
        return;
      }
      ThrowDocumentError(isolate,
                         "문서 변경 작업의 종류·필드·문자열이 잘못되었습니다",
                         true);
      try_catch.ReThrow();
      return;
    }
    const size_t operation_string_units =
        operation.namespace_utf16.size() + operation.name_utf16.size() +
        operation.value_utf16.size();
    if (operation_string_units >
        kMaximumBatchStringUnits - batch_string_units) {
      ThrowDocumentError(isolate,
                         "문서 변경 묶음 문자열은 UTF-16 코드 단위 1048576개까지 허용합니다",
                         true);
      try_catch.ReThrow();
      return;
    }
    batch_string_units += operation_string_units;
    owned.push_back(std::move(operation));
  }

  if (runtime->document_commit_callback == nullptr) {
    ThrowDocumentError(isolate, "문서 변경 callback이 등록되지 않았습니다", false);
    try_catch.ReThrow();
    return;
  }
  std::vector<SpinonDocumentOperation> operations;
  operations.reserve(owned.size());
  for (const auto &operation : owned) operations.push_back(operation.raw);
  SpinonDocumentReceipt receipt{};
  char error[1024] = {};
  const int32_t status = runtime->document_commit_callback(
      runtime->document_user_data, operations.data(), operations.size(), &receipt,
      error, sizeof(error));
  if (status != 0) {
    ThrowDocumentError(isolate,
                       error[0] == '\0' ? "문서 변경 묶음이 거부되었습니다"
                                        : std::string(error),
                       false);
    try_catch.ReThrow();
    return;
  }

  auto result = v8::Object::New(isolate);
  result->Set(context, v8::String::NewFromUtf8Literal(isolate, "changed"),
              v8::Boolean::New(isolate, receipt.changed != 0))
      .Check();
  result->Set(context,
              v8::String::NewFromUtf8Literal(isolate, "documentRevision"),
              v8::BigInt::NewFromUnsigned(isolate, receipt.document_revision))
      .Check();
  result->Set(context,
              v8::String::NewFromUtf8Literal(isolate, "renderTreeRevision"),
              v8::BigInt::NewFromUnsigned(isolate, receipt.render_tree_revision))
      .Check();
  result->Set(context, v8::String::NewFromUtf8Literal(isolate, "nodeCount"),
              v8::BigInt::NewFromUnsigned(isolate, receipt.node_count))
      .Check();
  args.GetReturnValue().Set(result);
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
    SpinonDocumentCommitCallback document_commit_callback, void *user_data,
    void *document_user_data) {
  std::call_once(platform_once, InitializeV8);
  auto *runtime = new SpinonV8Runtime;
  runtime->node_callback = node_callback;
  runtime->text_callback = text_callback;
  runtime->document_commit_callback = document_commit_callback;
  runtime->user_data = user_data;
  runtime->document_user_data = document_user_data;

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
    auto internal = v8::ObjectTemplate::New(runtime->isolate);
    internal->Set(runtime->isolate, "commitDocumentBatch",
                  v8::FunctionTemplate::New(runtime->isolate,
                                            CommitDocumentBatch));
    spinon->Set(runtime->isolate, "__internal", internal);
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
  runtime->was_terminated = false;
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
    runtime->was_terminated = try_catch.HasTerminated();
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
  runtime->was_terminated = false;
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
    runtime->was_terminated = try_catch.HasTerminated();
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

extern "C" int32_t spinon_v8_runtime_was_terminated(
    SpinonV8Runtime *runtime) {
  return runtime && runtime->was_terminated ? 1 : 0;
}

extern "C" void spinon_v8_runtime_terminate(SpinonV8Runtime *runtime) {
  if (runtime && runtime->isolate) runtime->isolate->TerminateExecution();
}

extern "C" void spinon_v8_runtime_cancel_termination(
    SpinonV8Runtime *runtime) {
  if (runtime && runtime->isolate) runtime->isolate->CancelTerminateExecution();
}

extern "C" uint64_t spinon_v8_current_thread_id() {
#if defined(__ANDROID__) || defined(__linux__)
  return static_cast<uint64_t>(syscall(SYS_gettid));
#elif defined(__APPLE__)
  uint64_t thread_id = 0;
  if (pthread_threadid_np(nullptr, &thread_id) == 0) return thread_id;
  return static_cast<uint64_t>(reinterpret_cast<uintptr_t>(pthread_self()));
#else
  return 0;
#endif
}

extern "C" void spinon_v8_runtime_free(SpinonV8Runtime *runtime) {
  if (!runtime) return;
  runtime->event_handler.Reset();
  runtime->context.Reset();
  runtime->isolate->Dispose();
  delete runtime->allocator;
  delete runtime;
}
