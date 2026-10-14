// T-1354: signs the Android release build with Julio's private release key.
// The key is handed to Gradle as `ZILAR_UPLOAD_*` properties or environment
// variables by the release workflow. When any of the four is missing the
// release build keeps signing with the debug key, so local builds are unchanged.

const { withAppBuildGradle } = require('expo/config-plugins');

/** The four values that together select the release signing config. */
const RELEASE_PROPERTIES = [
  'ZILAR_UPLOAD_STORE_FILE',
  'ZILAR_UPLOAD_STORE_PASSWORD',
  'ZILAR_UPLOAD_KEY_ALIAS',
  'ZILAR_UPLOAD_KEY_PASSWORD',
];

// The debug signing config in the generated app/build.gradle.
const DEBUG_SIGNING_CONFIG =
  /(\s*debug\s*\{\s*storeFile file\('debug\.keystore'\)\s*storePassword 'android'\s*keyAlias 'androiddebugkey'\s*keyPassword 'android'\s*\})/;

// The comment Expo writes above the release build type's signing line.
const RELEASE_BUILD_TYPE_SIGNING =
  /\/\/ Caution! In production, you need to generate your own keystore file\.\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\s*signingConfig signingConfigs\.debug/;

// The `android {` extension block, at the start of a line.
const ANDROID_EXTENSION = /^android \{$/m;

// Gradle reads the keystore values from `-P` properties or from the
// environment; `zilarReleaseSigning` is true only when all four are present.
function signingHelpers() {
  return [
    '// T-1354: release signing (apps/mobile/plugins/with-release-signing.js).',
    'def zilarReleaseProperty = { name ->',
    '    def value = project.findProperty(name)',
    '    if (value == null || value.toString().trim().isEmpty()) {',
    '        value = System.getenv(name)',
    '    }',
    '    return (value == null || value.toString().trim().isEmpty()) ? null : value',
    '}',
    `def zilarReleaseSigning = ${JSON.stringify(RELEASE_PROPERTIES)}.every { zilarReleaseProperty(it) != null }`,
  ].join('\n');
}

// The `signingConfigs.release` block, filled only when the values are set so an
// empty config never reaches a build that does not use it.
function releaseSigningConfig() {
  return [
    '',
    '        // T-1354: the private release keystore, filled only when configured.',
    '        release {',
    '            if (zilarReleaseSigning) {',
    "                storeFile file(zilarReleaseProperty('ZILAR_UPLOAD_STORE_FILE'))",
    "                storePassword zilarReleaseProperty('ZILAR_UPLOAD_STORE_PASSWORD')",
    "                keyAlias zilarReleaseProperty('ZILAR_UPLOAD_KEY_ALIAS')",
    "                keyPassword zilarReleaseProperty('ZILAR_UPLOAD_KEY_PASSWORD')",
    '            }',
    '        }',
  ].join('\n');
}

function replaceOnce(contents, pattern, replacement, what) {
  if (!pattern.test(contents)) {
    throw new Error(`with-release-signing: could not find ${what} in android/app/build.gradle`);
  }
  return contents.replace(pattern, replacement);
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('with-release-signing: android/app/build.gradle must be Groovy');
    }
    let contents = gradleConfig.modResults.contents;
    if (!contents.includes('ZILAR_UPLOAD_STORE_FILE')) {
      contents = replaceOnce(
        contents,
        ANDROID_EXTENSION,
        `${signingHelpers()}\n\nandroid {`,
        'the android extension block',
      );
      contents = replaceOnce(
        contents,
        DEBUG_SIGNING_CONFIG,
        `$1${releaseSigningConfig()}`,
        'the debug signing config',
      );
      contents = replaceOnce(
        contents,
        RELEASE_BUILD_TYPE_SIGNING,
        'signingConfig zilarReleaseSigning ? signingConfigs.release : signingConfigs.debug',
        'the release build type',
      );
      gradleConfig.modResults.contents = contents;
    }
    return gradleConfig;
  });
}

module.exports = withReleaseSigning;
