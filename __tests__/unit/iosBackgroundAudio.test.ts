import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('iOS navigation voice guidance in the background', () => {
  it('declares the audio background mode in app config and the shipped Info.plist', () => {
    const appJson = JSON.parse(readRepoFile('app.json'));
    expect(appJson.expo.ios.infoPlist.UIBackgroundModes).toEqual(
      expect.arrayContaining(['location', 'audio']),
    );

    // CI/Fastlane build the committed ios/ without running prebuild, so the
    // checked-in plist must carry the mode too.
    const plist = readRepoFile('ios/PolarisMaps/Info.plist');
    const modesMatch = plist.match(/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(modesMatch).not.toBeNull();
    expect(modesMatch![1]).toContain('<string>location</string>');
    expect(modesMatch![1]).toContain('<string>audio</string>');
  });

  it('configures the shared AVAudioSession for spoken navigation prompts', () => {
    // expo-speech (AVSpeechSynthesizer) sets no category, so iOS keeps the
    // default soloAmbient session: prompts are muted by the silent switch and
    // stop when the app is backgrounded or the screen is locked.
    for (const relativePath of [
      'plugins/native/PolarisMaps/AppDelegate.swift',
      'ios/PolarisMaps/AppDelegate.swift',
    ]) {
      const appDelegate = readRepoFile(relativePath);
      expect(appDelegate).toContain('AVAudioSession.sharedInstance().setCategory');
      expect(appDelegate).toContain('.playback');
      expect(appDelegate).toContain('.voicePrompt');
    }
  });
});
