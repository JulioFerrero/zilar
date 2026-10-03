#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "needle.h"

/* JNI shim between ZilarWhistleModule.kt and the prebuilt Needle engine.
   The engine keeps the model bytes passed to needle_load, so the .cact
   buffer is malloc'd once and never freed for the process lifetime. */

static unsigned char *g_model_bytes = NULL;

extern "C" {

JNIEXPORT jint JNICALL
Java_expo_modules_whistle_ZilarWhistleModule_nativeLoadModel(
    JNIEnv *env, jobject thiz, jstring path) {
  const char *c_path = env->GetStringUTFChars(path, NULL);
  if (c_path == NULL) {
    return -1;
  }
  FILE *file = fopen(c_path, "rb");
  env->ReleaseStringUTFChars(path, c_path);
  if (file == NULL) {
    return -1;
  }
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  fseek(file, 0, SEEK_SET);
  if (size <= 0) {
    fclose(file);
    return -1;
  }
  unsigned char *bytes = (unsigned char *)malloc((size_t)size);
  if (bytes == NULL) {
    fclose(file);
    return -1;
  }
  size_t read = fread(bytes, 1, (size_t)size, file);
  fclose(file);
  if (read != (size_t)size) {
    free(bytes);
    return -1;
  }
  int result = needle_load(bytes, (unsigned long long)size);
  if (result < 0) {
    free(bytes);
    return result;
  }
  /* The engine keeps the bytes: the old buffer (if any) stays alive too,
     since a loaded model may still reference it. */
  g_model_bytes = bytes;
  return result;
}

JNIEXPORT jstring JNICALL
Java_expo_modules_whistle_ZilarWhistleModule_nativeLastError(
    JNIEnv *env, jobject thiz) {
  const char *message = needle_last_error();
  if (message == NULL) {
    message = "";
  }
  return env->NewStringUTF(message);
}

JNIEXPORT jstring JNICALL
Java_expo_modules_whistle_ZilarWhistleModule_nativeTranscribeChunk(
    JNIEnv *env, jobject thiz, jfloatArray pcm, jint samples,
    jstring language, jint out_capacity) {
  if (pcm == NULL || samples <= 0 || out_capacity <= 0) {
    return env->NewStringUTF("NEEDLE_ERROR:empty audio");
  }
  jfloat *c_pcm = env->GetFloatArrayElements(pcm, NULL);
  if (c_pcm == NULL) {
    return env->NewStringUTF("NEEDLE_ERROR:empty audio");
  }
  const char *c_language = NULL;
  if (language != NULL) {
    c_language = env->GetStringUTFChars(language, NULL);
  }
  char *out = (char *)malloc((size_t)out_capacity);
  if (out == NULL) {
    env->ReleaseFloatArrayElements(pcm, c_pcm, JNI_ABORT);
    if (c_language != NULL) {
      env->ReleaseStringUTFChars(language, c_language);
    }
    return env->NewStringUTF("NEEDLE_ERROR:out of memory");
  }
  memset(out, 0, (size_t)out_capacity);
  int tokens = needle_transcribe(
      c_pcm, samples, c_language, NULL, 0, out, out_capacity);
  env->ReleaseFloatArrayElements(pcm, c_pcm, JNI_ABORT);
  if (c_language != NULL) {
    env->ReleaseStringUTFChars(language, c_language);
  }
  jstring result = NULL;
  if (tokens >= 0) {
    result = env->NewStringUTF(out);
  } else {
    const char *detail = needle_last_error();
    if (detail == NULL) {
      detail = "";
    }
    char *message = (char *)malloc(strlen(detail) + 15);
    if (message == NULL) {
      result = env->NewStringUTF("NEEDLE_ERROR:");
    } else {
      sprintf(message, "NEEDLE_ERROR:%s", detail);
      result = env->NewStringUTF(message);
      free(message);
    }
  }
  free(out);
  return result;
}

}  // extern "C"
