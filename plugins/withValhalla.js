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
  return crypto.randomBytes(12).toString('hex').toUpperCase();
}

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withValhalla] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withValhalla] Copied ' + src + ' → ' + dest);
  }
}

function registerNativeFiles(project) {
  const groupUuid = project.findPBXGroupKey({ name: 'PolarisMaps' });
  const mainTarget = project.getFirstTarget();

  for (const { dest } of NATIVE_FILES) {
    const relativePath = dest.replace(/^ios\//, '');
    const fileName = path.basename(dest);

    const existing = project.hasFile(relativePath);
    if (existing) {
      continue;
    }

    const file = project.addSourceFile(relativePath, { target: mainTarget.uuid }, groupUuid);
    if (file) {
      console.log('[withValhalla] Registered ' + fileName + ' in Xcode project');
    } else {
      console.warn('[withValhalla] Failed to register ' + fileName);
    }
  }
}

function addSpmPackage(project) {
  const objects = project.hash.project.objects;

  const existingRefs = objects.XCRemoteSwiftPackageReference || {};
  for (const key of Object.keys(existingRefs)) {
    if (key.endsWith('_comment')) continue;
    if (existingRefs[key].repositoryURL && existingRefs[key].repositoryURL.includes(SPM_URL)) {
      console.log('[withValhalla] valhalla-mobile SPM already present in pbxproj');
      return;
    }
  }

  const packageUuid = generateUuid();
  const productUuids = {};
  SPM_PRODUCTS.forEach((p) => {
    productUuids[p] = generateUuid();
  });

  if (!objects.XCRemoteSwiftPackageReference) {
    objects.XCRemoteSwiftPackageReference = {};
  }
  objects.XCRemoteSwiftPackageReference[packageUuid] = {
    isa: 'XCRemoteSwiftPackageReference',
    repositoryURL: '"' + SPM_URL + '"',
    requirement: {
      kind: 'upToNextMajorVersion',
      minimumVersion: SPM_VERSION,
    },
  };
  objects.XCRemoteSwiftPackageReference[packageUuid + '_comment'] = 'XCRemoteSwiftPackageReference "valhalla-mobile"';

  if (!objects.XCSwiftPackageProductDependency) {
    objects.XCSwiftPackageProductDependency = {};
  }
  SPM_PRODUCTS.forEach((p) => {
    const uuid = productUuids[p];
    objects.XCSwiftPackageProductDependency[uuid] = {
      isa: 'XCSwiftPackageProductDependency',
      package: packageUuid,
      productName: p,
    };
    objects.XCSwiftPackageProductDependency[uuid + '_comment'] = p;
  });

  const projectUuid = Object.keys(objects.PBXProject).find((k) => !k.endsWith('_comment'));
  const pbxProject = objects.PBXProject[projectUuid];
  if (!pbxProject.packageReferences) {
    pbxProject.packageReferences = [];
  }
  pbxProject.packageReferences.push({
    value: packageUuid,
    comment: 'XCRemoteSwiftPackageReference "valhalla-mobile"',
  });

  const mainTarget = project.getFirstTarget();
  const targetEntry = objects.PBXNativeTarget[mainTarget.uuid];
  if (!targetEntry.packageProductDependencies) {
    targetEntry.packageProductDependencies = [];
  }
  SPM_PRODUCTS.forEach((p) => {
    targetEntry.packageProductDependencies.push({
      value: productUuids[p],
      comment: p,
    });
  });

  console.log('[withValhalla] Added valhalla-mobile SPM to pbxproj');
}

function patchBridgingHeader() {
  const bridgingHeader = path.join(IOS_DIR, 'PolarisMaps', 'PolarisMaps-Bridging-Header.h');
  if (!fs.existsSync(bridgingHeader)) {
    console.warn('[withValhalla] Bridging header not found: ' + bridgingHeader);
    return;
  }

  let content = fs.readFileSync(bridgingHeader, 'utf8');
  if (content.includes('#import <React/RCTBridgeModule.h>')) {
    return;
  }

  content = content.trimEnd() + '\n\n#import <React/RCTBridgeModule.h>\n';
  fs.writeFileSync(bridgingHeader, content);
  console.log('[withValhalla] Patched PolarisMaps-Bridging-Header.h');
}

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

function modifyXcodeProject(project) {
  registerNativeFiles(project);
  addSpmPackage(project);
}

function withValhalla(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      patchBridgingHeader();
      patchPodfile();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    modifyXcodeProject(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withValhalla;
