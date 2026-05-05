const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const SPM_URL = 'https://github.com/Rallista/valhalla-mobile.git';
const SPM_VERSION = '0.5.0';
const SPM_PRODUCTS = ['Valhalla'];

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisValhalla.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisValhalla.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisValhalla.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisValhalla.m'),
  },
];

function generateUuid() {
  // 24-char hex string matching Xcode UUID format
  return crypto.randomBytes(12).toString('hex').toUpperCase();
}

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn(`[withValhalla] Source file not found: ${src}`);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log(`[withValhalla] Copied ${src} → ${dest}`);
  }
}

/**
 * Adds valhalla-mobile as a Swift Package Manager dependency to the
 * Xcode project. Modifies project.pbxproj directly via text manipulation
 * to insert the required XCRemoteSwiftPackageReference and
 * XCSwiftPackageProductDependency sections.
 */
function addSpmPackage() {
  const pbxprojPath = path.join(IOS_DIR, 'PolarisMaps.xcodeproj', 'project.pbxproj');
  if (!fs.existsSync(pbxprojPath)) {
    console.warn('[withValhalla] project.pbxproj not found at', pbxprojPath);
    return;
  }

  let content = fs.readFileSync(pbxprojPath, 'utf8');

  // Don't modify if valhalla-mobile is already referenced
  if (content.includes(SPM_URL)) {
    console.log('[withValhalla] valhalla-mobile SPM already present in pbxproj');
    return;
  }

  const packageUuid = generateUuid();
  const productUuids = {};
  SPM_PRODUCTS.forEach((p) => {
    productUuids[p] = generateUuid();
  });

  // Build the XCRemoteSwiftPackageReference entry
  const packageRef = `\t\t${packageUuid} /* XCRemoteSwiftPackageReference "valhalla-mobile" */ = {\n\t\t\tisa = XCRemoteSwiftPackageReference;\n\t\t\trepositoryURL = "${SPM_URL}";\n\t\t\trequirement = {\n\t\t\t\tkind = upToNextMajorVersion;\n\t\t\t\tminimumVersion = ${SPM_VERSION};\n\t\t\t};\n\t\t};`;

  // Build XCSwiftPackageProductDependency entries
  const productDeps = SPM_PRODUCTS.map(
    (p) =>
      `\t\t${productUuids[p]} /* ${p} */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = ${packageUuid} /* XCRemoteSwiftPackageReference "valhalla-mobile" */;\n\t\t\tproductName = ${p};\n\t\t};`,
  ).join('\n');

  // --- Insert XCRemoteSwiftPackageReference section ---
  if (content.includes('/* Begin XCRemoteSwiftPackageReference section */')) {
    // Append to existing section
    content = content.replace(
      /(\/\* End XCRemoteSwiftPackageReference section \*\/)/,
      `${packageRef}\n$1`,
    );
  } else {
    // Create new section before PBXBuildFile
    content = content.replace(
      /(\/\* Begin PBXBuildFile section \*\/)/,
      `/* Begin XCRemoteSwiftPackageReference section */\n${packageRef}\n/* End XCRemoteSwiftPackageReference section */\n\n$1`,
    );
  }

  // --- Insert XCSwiftPackageProductDependency section ---
  if (content.includes('/* Begin XCSwiftPackageProductDependency section */')) {
    content = content.replace(
      /(\/\* End XCSwiftPackageProductDependency section \*\/)/,
      `${productDeps}\n$1`,
    );
  } else {
    // Create new section after XCRemoteSwiftPackageReference
    content = content.replace(
      /(\/\* End XCRemoteSwiftPackageProductDependency section \*\/)/,
      `${productDeps}\n$1`,
    );
    if (!content.includes('XCSwiftPackageProductDependency section')) {
      content = content.replace(
        /(\/\* End XCRemoteSwiftPackageReference section \*\/)/,
        `$1\n\n/* Begin XCSwiftPackageProductDependency section */\n${productDeps}\n/* End XCSwiftPackageProductDependency section */`,
      );
    }
  }

  // --- Add product dependencies to the main target ---
  // Find the main app target (not the extension or test targets)
  const productDepList = SPM_PRODUCTS.map(
    (p) => `\t\t\t\t${productUuids[p]} /* ${p} */,`,
  ).join('\n');

  // Look for packageProductDependencies in the main PBXNativeTarget
  const targetRegex = /(\t\t\t\tpackageProductDependencies = \([\s\S]*?\))/;
  if (targetRegex.test(content)) {
    // Append to existing packageProductDependencies
    content = content.replace(
      /(\t\t\t\tpackageProductDependencies = \(\n)([\s\S]*?)(\t\t\t\t\);)/,
      (match, open, deps, close) => {
        // Only add if not already present
        for (const p of SPM_PRODUCTS) {
          if (!deps.includes(`/* ${p} */`)) {
            deps += productDepList + '\n';
            break;
          }
        }
        return open + deps + close;
      },
    );
  } else {
    // Find the main PBXNativeTarget and add packageProductDependencies
    // Look for the buildPhases closing and productReference
    content = content.replace(
      /(\t\t\t\tproductReference = [^\n]+\n)(\t\t\t};)/,
      `$1\t\t\t\tpackageProductDependencies = (\n${productDepList}\n\t\t\t\t);\n$2`,
    );
  }

  fs.writeFileSync(pbxprojPath, content);
  console.log('[withValhalla] Added valhalla-mobile SPM to pbxproj');
}

function withValhalla(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      addSpmPackage();
      return cfg;
    },
  ]);

  return config;
}

module.exports = withValhalla;
