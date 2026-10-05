/**
 * Re-exports the tested chunk/downmix planners for the app (T-0177 finding
 * 6): `transcribe` plans ranges with these, and the app's tests import them
 * through the module. The single source of truth lives in `./chunks`.
 */
export {
  downmixToMono,
  isSilentPcm,
  planQuietCutChunks,
  planWhistleChunks,
  quietestCut,
  resampleMonoTo16k,
  WHISTLE_CUT_SEARCH_SAMPLES,
  WHISTLE_MAX_CHUNK_SAMPLES,
  WHISTLE_SAMPLE_RATE,
} from 'zilar-whistle/src/chunks';
export type { WhistleChunk } from 'zilar-whistle/src/chunks';
