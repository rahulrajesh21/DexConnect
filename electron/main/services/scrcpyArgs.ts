import type { LaunchConfig, LaunchProfile, ResolutionPreset } from '../../../src/types';

export interface ResolutionDimension {
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: Record<ResolutionPreset, ResolutionDimension> = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
  'retina_16_10': { width: 2560, height: 1600 },
};

export const DEFAULT_DPIS: Record<ResolutionPreset, number> = {
  '1080p': 240,
  '1440p': 280,
  '4k': 320,
  'retina_16_10': 220,
};

export function resolveResolution(preset: ResolutionPreset): ResolutionDimension {
  return RESOLUTION_PRESETS[preset] ?? { width: 1920, height: 1080 };
}

export function getDefaultDpi(preset: ResolutionPreset): number {
  return DEFAULT_DPIS[preset] ?? 240;
}

export function clampDpi(dpi: number, fallback = 240): number {
  if (typeof dpi !== 'number' || Number.isNaN(dpi) || dpi <= 0) {
    return fallback;
  }
  return Math.min(640, Math.max(120, Math.round(dpi)));
}

export function sanitizeTitle(title?: string): string {
  if (!title) return 'Unknown Device';
  const cleaned = title.replace(/[\r\n\t]/g, ' ').trim();
  return cleaned || 'Unknown Device';
}

export function validateLaunchConfig(config: LaunchConfig): { valid: boolean; error?: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config object is required' };
  }
  if (!config.serial || typeof config.serial !== 'string' || !config.serial.trim()) {
    return { valid: false, error: 'Device serial is required' };
  }
  const validProfiles: LaunchProfile[] = [
    'samsung_dex',
    'motorola_ready_for',
    'universal_desktop',
    'screen_mirror',
  ];
  if (!config.profile || !validProfiles.includes(config.profile)) {
    return { valid: false, error: `Invalid launch profile: ${config.profile}` };
  }
  return { valid: true };
}

export function buildSamsungDexArgs(config: LaunchConfig): string[] {
  const { width, height } = resolveResolution(config.resolution);
  const defaultDpi = getDefaultDpi(config.resolution);
  const dpi = clampDpi(config.dpi, defaultDpi);
  const model = sanitizeTitle(config.modelName);

  return [
    '-s',
    config.serial,
    `--new-display=${width}x${height}/${dpi}`,
    '--stay-awake',
    '--keyboard=uhid',
    '--mouse=uhid',
    `--video-codec=${config.codec || 'h264'}`,
    `--max-fps=${config.refreshRate || 60}`,
    config.audioRouting ? '--audio-source=playback' : '--no-audio',
    '--window-title',
    `DexConnect — Samsung DeX (${model})`,
  ];
}

export function buildMotorolaReadyForArgs(config: LaunchConfig): string[] {
  const { width, height } = resolveResolution(config.resolution);
  const defaultDpi = getDefaultDpi(config.resolution);
  const dpi = clampDpi(config.dpi, defaultDpi);
  const model = sanitizeTitle(config.modelName);

  return [
    '-s',
    config.serial,
    `--new-display=${width}x${height}/${dpi}`,
    '--turn-screen-off',
    '--stay-awake',
    '--keyboard=uhid',
    '--mouse=uhid',
    `--video-codec=${config.codec || 'h264'}`,
    `--max-fps=${config.refreshRate || 60}`,
    config.audioRouting ? '--audio-source=playback' : '--no-audio',
    '--window-title',
    `DexConnect — Smart Connect (${model})`,
  ];
}

export function buildUniversalDesktopArgs(config: LaunchConfig): string[] {
  const { width, height } = resolveResolution(config.resolution);
  const defaultDpi = getDefaultDpi(config.resolution);
  const dpi = clampDpi(config.dpi, defaultDpi);
  const model = sanitizeTitle(config.modelName);

  return [
    '-s',
    config.serial,
    `--new-display=${width}x${height}/${dpi}`,
    '--turn-screen-off',
    '--stay-awake',
    '--keyboard=uhid',
    '--mouse=uhid',
    `--video-codec=${config.codec || 'h264'}`,
    `--max-fps=${config.refreshRate || 60}`,
    config.audioRouting ? '--audio-source=playback' : '--no-audio',
    '--window-title',
    `DexConnect — Android Desktop (${model})`,
  ];
}

export function buildScreenMirrorArgs(config: LaunchConfig): string[] {
  const { width, height } = resolveResolution(config.resolution);
  const maxSize = Math.max(width, height);
  const model = sanitizeTitle(config.modelName);

  const args: string[] = [
    '-s',
    config.serial,
    '--turn-screen-off',
    '--stay-awake',
    `--max-size=${maxSize}`,
    '--video-buffer=0',
  ];

  if (config.audioRouting) {
    args.push('--audio-source=playback', '--audio-buffer=20');
  } else {
    args.push('--no-audio');
  }

  args.push(
    '--keyboard=uhid',
    '--mouse=uhid',
    `--video-codec=${config.codec || 'h264'}`,
    `--max-fps=${config.refreshRate || 60}`,
    '--window-title',
    `DexConnect — Mirror (${model})`
  );

  return args;
}

export function buildScrcpyArgs(config: LaunchConfig): string[] {
  const validation = validateLaunchConfig(config);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid launch config');
  }

  switch (config.profile) {
    case 'samsung_dex':
      return buildSamsungDexArgs(config);
    case 'motorola_ready_for':
      return buildMotorolaReadyForArgs(config);
    case 'universal_desktop':
      return buildUniversalDesktopArgs(config);
    case 'screen_mirror':
      return buildScreenMirrorArgs(config);
    default:
      throw new Error(`Unsupported launch profile: ${(config as any).profile}`);
  }
}
