package expo.modules.whistle

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

private const val TARGET_SAMPLE_RATE = 16000
private const val TARGET_CHANNELS = 1
private const val OUT_JSON_CAPACITY = 8192

/**
 * The ZilarWhistle native module (T-0177): on-device speech-to-text with the
 * Cactus Whistle model through the Needle engine.
 *
 * Android arm64-v8a only: the prebuilt `libneedle.a` is AArch64, so every
 * method reports `unavailable` on other ABIs (and on iOS, where the module
 * is not declared — `expo-module.config.json` lists Android only — the JS
 * side reports `unavailable` too).
 *
 * The engine holds one process-global, non-thread-safe model, so all
 * loads and transcriptions are serialised on one lock.
 */
class ZilarWhistleModule : Module() {
  private val lock = Any()
  private var modelLoaded = false

  companion object {
    /** Refuses decodes longer than this (10 minutes, far above any voice note). */
    const val MAX_DECODE_US = 10L * 60L * 1_000_000L
    /** Fails the decode when MediaCodec produces nothing for this long. */
    const val DECODE_STALL_MS = 30_000L

    init {
      try {
        System.loadLibrary("zilar-whistle")
      } catch (_: UnsatisfiedLinkError) {
        // Loading fails on non-arm64 devices (the .so only ships arm64-v8a):
        // methods below report `unavailable` instead of throwing at load.
      }
    }
  }

  private fun abiSupported(): Boolean =
    Build.SUPPORTED_ABIS.any { it == "arm64-v8a" }

  external fun nativeLoadModel(path: String): Int
  external fun nativeLastError(): String
  external fun nativeTranscribeChunk(
    pcm: FloatArray,
    samples: Int,
    language: String?,
    outCapacity: Int,
  ): String

  override fun definition() = ModuleDefinition {
    Name("ZilarWhistle")

    Constant("SUPPORTED_ABI") {
      "arm64-v8a"
    }

    Function("isAvailable") {
      abiSupported()
    }

    Function("modelStatus") {
      synchronized(lock) {
        if (modelLoaded) "ready" else "missing"
      }
    }

    AsyncFunction("loadModel") Coroutine { path: String, promise: Promise ->
      if (!abiSupported()) {
        promise.reject(CodedException("unavailable", "Whistle runs on Android arm64 only", null))
        return@Coroutine
      }
      val file = File(path)
      if (!file.isFile || file.length() == 0L) {
        promise.reject(CodedException("model_missing", "The Whistle model file is missing", null))
        return@Coroutine
      }
      synchronized(lock) {
        try {
          val result = nativeLoadModel(path)
          if (result < 0) {
            val detail = runCatching { nativeLastError() }.getOrNull().orEmpty()
            promise.reject(CodedException("load_failed", "Could not load the Whistle model: $detail".trimEnd(':').trim(), null))
            return@Coroutine
          }
          modelLoaded = true
          promise.resolve("ready")
        } catch (error: UnsatisfiedLinkError) {
          promise.reject(CodedException("unavailable", "Whistle runs on Android arm64 only", error))
        }
      }
    }

    AsyncFunction("transcribeFile") Coroutine { path: String, language: String?, promise: Promise ->
      transcribeRanges(path, null, language, promise)
    }

    AsyncFunction("transcribeRanges") Coroutine {
        path: String,
        rangesMs: List<List<Double>>?,
        language: String?,
        promise: Promise,
      ->
      transcribeRanges(path, rangesMs, language, promise)
    }
  }

  /**
   * The shared transcription body: decodes the file, then transcribes the
   * JS-planned (startMs, endMs) ranges — or the whole clip when `rangesMs`
   * is null. The native side never plans chunks itself: the tested
   * `planQuietCutChunks` in `whistle-last-voice.ts` owns the rule.
   */
  private suspend fun transcribeRanges(
    path: String,
    rangesMs: List<List<Double>>?,
    language: String?,
    promise: Promise,
  ) {
      if (!abiSupported()) {
        promise.reject(CodedException("unavailable", "Whistle runs on Android arm64 only", null))
        return
      }
      val loaded = synchronized(lock) { modelLoaded }
      if (!loaded) {
        promise.reject(CodedException("model_missing", "The Whistle model is not loaded", null))
        return
      }
      try {
        val audio = decodeToMono16k(path)
        if (audio.isSilent) {
          promise.resolve(
            mapOf(
              "text" to "",
              "language" to "",
              "ttftMs" to 0.0,
              "decodeTps" to 0.0,
              "audioMs" to audio.durationMs,
            ),
          )
          return
        }
        val chunks = sliceRanges(audio.samples, rangesMs)
        val texts = mutableListOf<String>()
        var detectedLanguage = ""
        var ttftMs = 0.0
        var decodeTps = 0.0
        var tokens = 0
        synchronized(lock) {
          for ((index, chunk) in chunks.withIndex()) {
            // Only the first chunk may detect the language; later chunks
            // reuse it so a long note does not flip language mid-way.
            val chunkLanguage = if (index == 0) language else (detectedLanguage.ifEmpty { language })
            val json = nativeTranscribeChunk(chunk, chunk.size, chunkLanguage, OUT_JSON_CAPACITY)
            val parsed = parseTranscriptJson(json)
              ?: throw CodedException("transcribe_failed", runCatching { nativeLastError() }.getOrNull().orEmpty().ifEmpty { "The transcription failed" }, null)
            tokens += parsed.tokens
            if (parsed.text.isNotEmpty()) {
              texts.add(parsed.text)
            }
            if (index == 0) {
              detectedLanguage = parsed.language
              ttftMs = parsed.ttftMs
              decodeTps = parsed.decodeTps
            }
          }
        }
        promise.resolve(
          mapOf(
            "text" to texts.joinToString(" "),
            "language" to detectedLanguage,
            "ttftMs" to ttftMs,
            "decodeTps" to decodeTps,
            "audioMs" to audio.durationMs,
          ),
        )
      } catch (error: CodedException) {
        promise.reject(error)
      } catch (error: UnsatisfiedLinkError) {
        promise.reject(CodedException("unavailable", "Whistle runs on Android arm64 only", error))
      } catch (error: Exception) {
        promise.reject(CodedException("transcribe_failed", error.message ?: "The transcription failed", error))
      }
  }

  /**
   * Slices the decoded 16 kHz mono samples into the JS-planned ranges. Each
   * range is (startMs, endMs); a null or empty plan means the whole clip as
   * one chunk. Ranges are clamped to the clip and capped at 28 s each so a
   * drifted plan can never breach the 30 s engine limit.
   */
  private fun sliceRanges(
    samples: FloatArray,
    rangesMs: List<List<Double>>?,
  ): List<FloatArray> {
    val maxChunk = 28 * TARGET_SAMPLE_RATE
    if (rangesMs.isNullOrEmpty()) {
      return listOf(samples)
    }
    val totalSamples = samples.size
    val chunks = mutableListOf<FloatArray>()
    for (range in rangesMs) {
      if (range.size < 2) {
        continue
      }
      val startSample = ((range[0] ?: 0.0) * TARGET_SAMPLE_RATE / 1000.0).toInt().coerceIn(0, totalSamples)
      val endSample = ((range[1] ?: 0.0) * TARGET_SAMPLE_RATE / 1000.0).toInt().coerceIn(startSample, totalSamples)
      if (endSample - startSample <= 0) {
        continue
      }
      var cursor = startSample
      // A drifted range longer than 28 s is hard-split; the JS plan never
      // sends one, but the engine limit must hold regardless.
      while (cursor < endSample) {
        val hardEnd = minOf(cursor + maxChunk, endSample)
        chunks.add(samples.copyOfRange(cursor, hardEnd))
        cursor = hardEnd
      }
    }
    return if (chunks.isEmpty()) listOf(samples) else chunks
  }

  private data class DecodedAudio(val samples: FloatArray, val durationMs: Int, val isSilent: Boolean)

  private data class ParsedTranscript(
    val text: String,
    val language: String,
    val ttftMs: Double,
    val decodeTps: Double,
    val tokens: Int,
  )

  /**
   * Decodes an audio file (m4a/AAC as the app records, also wav) to 16 kHz
   * mono float PCM in [-1, 1] with Android's MediaExtractor + MediaCodec,
   * downmixing to mono and resampling with linear interpolation.
   */
  private fun decodeToMono16k(path: String): DecodedAudio {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
    } catch (error: Exception) {
      extractor.release()
      throw CodedException("not_audio", "Could not read the audio file", error)
    }
    try {
      val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
        val format = extractor.getTrackFormat(index)
        (format.getString(MediaFormat.KEY_MIME) ?: "").startsWith("audio/")
      } ?: throw CodedException("not_audio", "The file holds no audio track", null)
      extractor.selectTrack(trackIndex)
      val format = extractor.getTrackFormat(trackIndex)
      val mime = format.getString(MediaFormat.KEY_MIME)
        ?: throw CodedException("not_audio", "The file holds no audio track", null)
      val sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      val channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1
      val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      if (durationUs > MAX_DECODE_US) {
        throw CodedException("too_long", "The audio is too long to transcribe on the device", null)
      }
      // Caps the decoded PCM so a lying container cannot grow the buffer
      // past the 10-minute bound (16 kHz mono floats).
      val maxSamples = (MAX_DECODE_US / 1_000_000L * TARGET_SAMPLE_RATE).toInt()
      val codec = MediaCodec.createDecoderByType(mime)
      try {
        codec.configure(format, null, null, 0)
        codec.start()
        val mono = mutableListOf<Float>()
        val bufferInfo = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var lastProgressMs = System.currentTimeMillis()
        while (!outputDone) {
          if (!inputDone) {
            val inputIndex = codec.dequeueInputBuffer(10_000)
            if (inputIndex >= 0) {
              val inputBuffer = codec.getInputBuffer(inputIndex)!!
              val sample = extractor.readSampleData(inputBuffer, 0)
              if (sample < 0) {
                codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                if (extractor.sampleTime > MAX_DECODE_US) {
                  throw CodedException("too_long", "The audio is too long to transcribe on the device", null)
                }
                codec.queueInputBuffer(inputIndex, 0, sample, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }
          val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
          when {
            outputIndex >= 0 -> {
              lastProgressMs = System.currentTimeMillis()
              val outputBuffer = codec.getOutputBuffer(outputIndex)!!
              appendDecodedSamples(outputBuffer, bufferInfo, channels, mono)
              codec.releaseOutputBuffer(outputIndex, false)
              if (mono.size > maxSamples) {
                throw CodedException("too_long", "The audio is too long to transcribe on the device", null)
              }
              if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                outputDone = true
              }
            }
            outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              // The decoder settled its output format; samples keep flowing.
            }
          }
          if (!outputDone && System.currentTimeMillis() - lastProgressMs > DECODE_STALL_MS) {
            throw CodedException("transcribe_failed", "The audio decoder stalled", null)
          }
        }
        val monoArray = mono.toFloatArray()
        // `appendDecodedSamples` already downmixed to mono: the resampler
        // gets channel count 1, never the interleaved path again.
        val resampled = resampleTo16k(monoArray, sampleRate, 1)
        val durationMs = if (durationUs > 0) (durationUs / 1000).toInt() else ((resampled.size * 1000.0) / TARGET_SAMPLE_RATE).toInt()
        return DecodedAudio(resampled, durationMs, resampled.all { abs(it) < 0.005f })
      } finally {
        try {
          codec.stop()
        } catch (_: Exception) {
        }
        codec.release()
      }
    } finally {
      extractor.release()
    }
  }

  private fun appendDecodedSamples(
    buffer: ByteBuffer,
    info: MediaCodec.BufferInfo,
    channels: Int,
    out: MutableList<Float>,
  ) {
    val ordered = buffer.order(ByteOrder.nativeOrder())
    val shorts = info.size / 2
    val frames = if (channels > 0) shorts / channels else 0
    for (frame in 0 until frames) {
      var sum = 0f
      for (channel in 0 until channels) {
        val position = info.offset + (frame * channels + channel) * 2
        sum += ordered.getShort(position) / 32768f
      }
      out.add((sum / channels).coerceIn(-1f, 1f))
    }
  }

  private fun resampleTo16k(interleavedOrMono: FloatArray, sampleRate: Int, channels: Int): FloatArray {
    val mono = if (channels <= 1) {
      interleavedOrMono
    } else {
      FloatArray(interleavedOrMono.size / channels) { frame ->
        var sum = 0f
        for (channel in 0 until channels) {
          sum += interleavedOrMono[frame * channels + channel] ?: 0f
        }
        sum / channels
      }
    }
    if (sampleRate == TARGET_SAMPLE_RATE) {
      return mono
    }
    if (mono.isEmpty() || sampleRate <= 0) {
      return mono
    }
    val ratio = sampleRate.toDouble() / TARGET_SAMPLE_RATE
    val outSize = (mono.size / ratio).toInt()
    return FloatArray(outSize) { index ->
      val position = index * ratio
      val lower = position.toInt().coerceIn(0, mono.size - 1)
      val upper = (lower + 1).coerceIn(0, mono.size - 1)
      val fraction = (position - lower).toFloat()
      mono[lower] * (1 - fraction) + mono[upper] * fraction
    }
  }

  private fun parseTranscriptJson(json: String): ParsedTranscript? {
    val text = extractJsonString(json, "text") ?: return null
    val language = extractJsonString(json, "language") ?: ""
    val ttft = extractJsonNumber(json, "ttft_ms") ?: 0.0
    val tps = extractJsonNumber(json, "decode_tps") ?: 0.0
    return ParsedTranscript(text, language, ttft, tps, text.length)
  }

  private fun extractJsonString(json: String, key: String): String? {
    val marker = "\"$key\""
    val keyIndex = json.indexOf(marker)
    if (keyIndex < 0) {
      return null
    }
    val colon = json.indexOf(':', keyIndex + marker.length)
    if (colon < 0) {
      return null
    }
    val openQuote = json.indexOf('"', colon + 1)
    if (openQuote < 0) {
      return null
    }
    val out = StringBuilder()
    var index = openQuote + 1
    while (index < json.length) {
      val char = json[index]
      if (char == '\\' && index + 1 < json.length) {
        val next = json[index + 1]
        when (next) {
          '"', '\\', '/' -> out.append(next)
          'n' -> out.append('\n')
          't' -> out.append('\t')
          'u' -> {
            val hex = json.substring(index + 2, minOf(index + 6, json.length))
            out.append(hex.toIntOrNull(16)?.toChar() ?: '?')
            index += 4
          }
          else -> out.append(next)
        }
        index += 2
      } else if (char == '"') {
        return out.toString()
      } else {
        out.append(char)
        index += 1
      }
    }
    return null
  }

  private fun extractJsonNumber(json: String, key: String): Double? {
    val marker = "\"$key\""
    val keyIndex = json.indexOf(marker)
    if (keyIndex < 0) {
      return null
    }
    val colon = json.indexOf(':', keyIndex + marker.length)
    if (colon < 0) {
      return null
    }
    var index = colon + 1
    while (index < json.length && json[index].isWhitespace()) {
      index += 1
    }
    val start = index
    while (index < json.length && (json[index].isDigit() || json[index] == '.' || json[index] == '-' || json[index] == '+' || json[index] == 'e' || json[index] == 'E')) {
      index += 1
    }
    return json.substring(start, index).toDoubleOrNull()
  }
}
