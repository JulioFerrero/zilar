cmake_minimum_required(VERSION 3.22.1)

project(zilar-whistle)

# The Needle engine ships as a prebuilt AArch64 static library; fetch-engine.sh
# downloads it into android/third_party/needle (gitignored). Only arm64-v8a
# is built: the Gradle abiFilters exclude every other ABI.
set(NEEDLE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../third_party/needle)

if(NOT EXISTS "${NEEDLE_DIR}/libneedle.a")
  message(FATAL_ERROR "libneedle.a is missing in ${NEEDLE_DIR}: run scripts/fetch-engine.sh first")
endif()

add_library(needle STATIC IMPORTED)
set_target_properties(needle PROPERTIES IMPORTED_LOCATION "${NEEDLE_DIR}/libneedle.a")

add_library(
  zilar-whistle
  SHARED
  whistle-jni.cpp
)

target_include_directories(zilar-whistle PRIVATE "${NEEDLE_DIR}")

find_library(log-lib log)

target_link_libraries(
  zilar-whistle
  needle
  c++_shared
  ${log-lib}
)
