import React from 'react';
import { Tv, Monitor, Layers, Cast } from 'lucide-react';
import type { LaunchProfile } from '../types';

export interface ProfileDefinition {
  id: LaunchProfile;
  title: string;
  subtitle: string;
  badge: string;
  color: string;
  glow: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const PROFILES: ProfileDefinition[] = [
  {
    id: 'samsung_dex',
    title: 'Samsung DeX Desktop',
    subtitle: 'Native multi-window Samsung workstation with UHID trackpad & audio forwarding',
    badge: 'DeX 🪐',
    color: 'from-blue-600/30 to-indigo-900/40',
    glow: 'rgba(59, 130, 246, 0.4)',
    icon: Tv,
  },
  {
    id: 'motorola_ready_for',
    title: 'Motorola Smart Connect',
    subtitle: 'Motorola Ready For desktop interface optimized for ThinkPhone & Edge',
    badge: 'Ready For ⚡',
    color: 'from-cyan-600/30 to-blue-900/40',
    glow: 'rgba(6, 182, 212, 0.4)',
    icon: Monitor,
  },
  {
    id: 'universal_desktop',
    title: 'Universal Android Desktop',
    subtitle: 'Virtual display freeform desktop for Pixel, Xiaomi, OnePlus & others',
    badge: 'Android 🖥️',
    color: 'from-purple-600/30 to-violet-900/40',
    glow: 'rgba(168, 85, 247, 0.4)',
    icon: Layers,
  },
  {
    id: 'screen_mirror',
    title: 'Low-Latency Screen Mirror',
    subtitle: 'Zero-latency phone display mirroring with screen-off power saving',
    badge: 'Mirror 📱',
    color: 'from-emerald-600/30 to-teal-900/40',
    glow: 'rgba(16, 185, 129, 0.4)',
    icon: Cast,
  },
];

interface LaunchCardProps {
  profile: ProfileDefinition;
  isSelected: boolean;
  onSelect: (id: LaunchProfile) => void;
}

export const LaunchCard: React.FC<LaunchCardProps> = ({
  profile,
  isSelected,
  onSelect,
}) => {
  const IconComponent = profile.icon;

  return (
    <div
      onClick={() => onSelect(profile.id)}
      style={{
        boxShadow: isSelected ? `0 0 25px -4px ${profile.glow}` : undefined,
      }}
      className={`relative p-4 rounded-xl border cursor-pointer transition-all duration-200 overflow-hidden select-none ${
        isSelected
          ? `bg-gradient-to-br ${profile.color} border-white/30`
          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
      }`}
    >
      <div className="flex items-start justify-between">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 transition-colors ${
            isSelected ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'
          }`}
        >
          <IconComponent className="w-5 h-5" />
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isSelected
              ? 'bg-white/20 text-white font-semibold'
              : 'bg-white/5 text-gray-300'
          }`}
        >
          {profile.badge}
        </span>
      </div>

      <div className="font-semibold text-sm text-white leading-tight">{profile.title}</div>
      <div className="text-xs text-gray-400 mt-1.5 leading-snug">{profile.subtitle}</div>

      {isSelected && (
        <div className="mt-3 flex items-center space-x-1.5 text-[11px] text-blue-300 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span>Selected Profile</span>
        </div>
      )}
    </div>
  );
};
