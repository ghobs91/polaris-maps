#!/usr/bin/env ruby
# frozen_string_literal: true

# Generates a throwaway Xcode project containing ONLY a UI-test bundle.
#
# The app target is not part of it: the tests launch the already-installed app
# with `XCUIApplication(bundleIdentifier:)`, so this harness never touches
# `ios/PolarisMaps.xcodeproj` (a prebuild artifact) and never needs the app's
# sources to build. It exists because this checkout has no other way to send
# real taps: `idb` is unavailable, there is no Detox config, and Apple Events to
# System Events are denied.
#
# Usage: ruby tools/ios-capture/generate.rb

require 'xcodeproj'
require 'fileutils'

ROOT = File.expand_path(__dir__)
OUT = File.join(ROOT, 'build', 'CaptureHarness.xcodeproj')
BUNDLE_ID = 'com.polarismaps.app'

FileUtils.rm_rf(File.join(ROOT, 'build'))
FileUtils.mkdir_p(File.dirname(OUT))

project = Xcodeproj::Project.new(OUT)
project.root_object.attributes['LastUpgradeCheck'] = '2700'

target = project.new_target(:ui_test_bundle, 'CaptureHarnessUITests', :ios, '16.4')
target.build_configurations.each do |config|
  settings = config.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.polarismaps.capture-harness'
  settings['SWIFT_VERSION'] = '5.0'
  settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  settings['CODE_SIGNING_ALLOWED'] = 'NO'
  # No TEST_TARGET_NAME on purpose: the launched app is chosen at runtime.
  settings['TEST_TARGET_NAME'] = nil
  settings['TARGETED_DEVICE_FAMILY'] = '1'
end

group = project.main_group.new_group('CaptureHarness', ROOT)
target.add_file_references([group.new_file('CaptureTests.swift')])

scheme = Xcodeproj::XCScheme.new
scheme.add_test_target(target)
scheme.save_as(OUT, 'CaptureHarness', true)

project.save
puts "wrote #{OUT} (app under test: #{BUNDLE_ID})"
