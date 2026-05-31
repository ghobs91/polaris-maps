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
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisMapKit.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisMapKit.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisMapKit.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisMapKit.m'),
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
 * Registers native source files in the Xcode project so they get compiled.
 * Adds PBXFileReference and PBXBuildFile entries, and adds files to the
 * PolarisMaps group and Sources build phase.
 */
function registerNativeFiles() {
  const pbxprojPath = path.join(IOS_DIR, 'PolarisMaps.xcodeproj', 'project.pbxproj');
  if (!fs.existsSync(pbxprojPath)) {
    console.warn('[withValhalla] project.pbxproj not found at', pbxprojPath);
    return;
  }

  let content = fs.readFileSync(pbxprojPath, 'utf8');
  let modified = false;

  for (const { dest } of NATIVE_FILES) {
    const fileName = path.basename(dest);
    const relativePath = dest.replace(/^ios\//, '');

    // Skip if already registered
    if (content.includes(`/* ${fileName} */`)) {
      continue;
    }

    const fileRefUuid = generateUuid();
    const buildFileUuid = generateUuid();
    const fileType = fileName.endsWith('.swift') ? 'sourcecode.swift' : 'sourcecode.c.objc';

    // 1. Add PBXBuildFile entry
    const buildFileEntry = `\t\t${buildFileUuid} /* ${fileName} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefUuid} /* ${fileName} */; };`;
    content = content.replace(
      /(\/\* End PBXBuildFile section \*\/)/,
      `${buildFileEntry}\n$1`
    );

    // 2. Add PBXFileReference entry
    const fileRefEntry = `\t\t${fileRefUuid} /* ${fileName} */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = ${fileType}; name = "${fileName}"; path = "${relativePath}"; sourceTree = "<group>"; };`;
    content = content.replace(
      /(\/\* End PBXFileReference section \*\/)/,
      `${fileRefEntry}\n$1`
    );

    // 3. Add to PolarisMaps group (after noop-file.swift)
    content = content.replace(
      /(7B2D9EF040C4414289F6A7F8 \/\* noop-file\.swift \*\/,)/,
      `$1\n\t\t\t\t${fileRefUuid} /* ${fileName} */,`
    );

    // 4. Add to Sources build phase (after noop-file.swift)
    content = content.replace(
      /(3F5AFB4873C74F8F8F5AEB64 \/\* noop-file\.swift in Sources \*\/,)/,
      `$1\n\t\t\t\t${buildFileUuid} /* ${fileName} in Sources */,`
    );

    modified = true;
    console.log(`[withValhalla] Registered ${fileName} in Xcode project`);
  }

  if (modified) {
    fs.writeFileSync(pbxprojPath, content);
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

/**
 * Patches the Podfile post_install hook to fix a fmt 11.x consteval
 * compilation issue with the iOS 26 SDK / Xcode 26. This was previously
 * in the withLiveActivities plugin.
 */
function patchPodfile() {
  const podfilePath = path.join(IOS_DIR, 'Podfile');
  if (!fs.existsSync(podfilePath)) return;

  let content = fs.readFileSync(podfilePath, 'utf8');
  if (content.includes('FMT_CONSTEVAL_PATCHED')) {
    console.log('[withValhalla] fmt patch already applied');
    return;
  }

  const fmtFix = `    # Fix fmt 11.x consteval issue with iOS 26 SDK / Xcode 26.
    # Patches fmt/base.h after pod install downloads fresh sources.
    fmt_base_h = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base_h)
      content = File.read(fmt_base_h)
      unless content.include?('FMT_CONSTEVAL_PATCHED')
        lines = content.lines
        new_lines = []
        i = 0
        while i < lines.length
          line = lines[i]
          if line.include?('Detect consteval, C++20 constexpr extensions')
            new_lines << "// FMT_CONSTEVAL_PATCHED: Force consteval off for iOS 26 SDK / Xcode 26 compatibility.\\n"
            new_lines << "#define FMT_USE_CONSTEVAL 0\\n"
            new_lines << "#define FMT_CONSTEVAL\\n"
            new_lines << "#define FMT_CONSTEXPR20\\n"
            found_first_endif = false
            i += 1
            while i < lines.length
              if lines[i].strip == '#if FMT_USE_CONSTEVAL' && found_first_endif
                i += 1
                while i < lines.length
                  break if lines[i].strip == '#endif'
                  i += 1
                end
                break
              end
              if lines[i].strip == '#endif' && !found_first_endif
                found_first_endif = true
              end
              i += 1
            end
          else
            new_lines << line
          end
          i += 1
        end
        FileUtils.chmod(0644, fmt_base_h)
        File.write(fmt_base_h, new_lines.join)
      end
    end
`;

  // Insert inside the post_install block after the resource-bundle-fix code
  const oldBlock = `          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end
  end`;
  const newBlock = `          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end

${fmtFix}
  end`;

  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(podfilePath, content);
  console.log('[withValhalla] Applied fmt consteval patch to Podfile');
}

function withValhalla(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      registerNativeFiles();
      addSpmPackage();
      patchPodfile();
      return cfg;
    },
  ]);

  return config;
}

module.exports = withValhalla;
