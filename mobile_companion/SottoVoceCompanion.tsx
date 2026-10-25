/**
 * sottovoce — React Native Low-Brightness OLED Theatre Companion
 * Designed for unobtrusive in-auditorium libretto tracking, zero-click context detection,
 * and bone-conduction whispered queries via Gemini 3.8 Live.
 */

import React, { useState } from 'react';

export interface SottoVoceNativeProps {
  apiBaseUrl: string;
  defaultLat?: number;
  defaultLng?: number;
}

export const SOTTOSCHEMA_JSON = {
  input: {
    video_frame: 'base64 JPEG (stage set / playbill / architectural interior)',
    audio_buffer: '5s 16kHz PCM/WAV ambient snippet (orchestral motif + sung vocal line)',
    gps_coordinates: { lat: 51.5129, lng: -0.1222 },
    timestamp_iso: '2026-10-24T19:48:12Z',
  },
  output: {
    work_id: 'puccini_tosca_1900',
    act: 2,
    scene: 5,
    current_bar: 522,
    current_line_index: 1,
    synopsis_so_far: 'Spoiler-safe summary of the previous 5 minutes on stage.',
    subtext_explanation: 'Plain British English explanation of the tapped Italian/French/German idiom.',
    nearest_amenities: [
      {
        node_id: 'node_wc_roh_hamlyn',
        name: 'ROH Linbury Mezzanine WCs',
        category: 'public_toilet',
        distance_meters: 28,
        walking_mins: 1,
        queue_or_status: 'Est. interval queue: 3 min · Step-free WC',
      },
    ],
  },
};

export function SottoVoceCompanionReference({ apiBaseUrl }: SottoVoceNativeProps) {
  const [whisperQuery, setWhisperQuery] = useState('Wait, why did Scarpia just give her that letter?');
  return null; // Exported reference module for React Native / Expo companion client
}
