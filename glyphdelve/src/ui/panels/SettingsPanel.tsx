import React, { useState } from 'react';
import type { AccessibilitySettings } from '../../types';
import { DEFAULT_BINDINGS } from '../../engine/InputManager';
import type { KeyBindings } from '../../engine/InputManager';

interface SettingsPanelProps {
  settings: AccessibilitySettings;
  onSave: (settings: AccessibilitySettings) => void;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSave, onClose }) => {
  const [local, setLocal] = useState<AccessibilitySettings>({ ...settings });
  const [rebindingKey, setRebindingKey] = useState<string | null>(null);

  const handleChange = <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    onSave(next);
  };

  const startRebind = (action: string) => {
    setRebindingKey(action);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const newBindings = { ...local.keyBindings, [action]: e.code };
      const next = { ...local, keyBindings: newBindings };
      setLocal(next);
      onSave(next);
      setRebindingKey(null);
      window.removeEventListener('keydown', handler);
    };
    window.addEventListener('keydown', handler);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Settings</h2>

        {/* Game Speed */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Game Speed</h3>
          <div style={styles.row}>
            {[0.75, 1.0, 1.25].map(s => (
              <button
                key={s}
                style={{ ...styles.optionBtn, backgroundColor: local.gameSpeed === s ? '#2e7d32' : '#333' }}
                onClick={() => handleChange('gameSpeed', s as 0.75 | 1.0 | 1.25)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Font Scale */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Font Scale</h3>
          <div style={styles.row}>
            {[100, 125, 150].map(s => (
              <button
                key={s}
                style={{ ...styles.optionBtn, backgroundColor: local.fontScale === s ? '#2e7d32' : '#333' }}
                onClick={() => handleChange('fontScale', s as 100 | 125 | 150)}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Accessibility</h3>
          <ToggleRow label="Colorblind Mode (patterns/icons)" value={local.colorblindMode} onChange={v => handleChange('colorblindMode', v)} />
          <ToggleRow label="Reduced Motion" value={local.reducedMotion} onChange={v => handleChange('reducedMotion', v)} />
          <ToggleRow label="Screen Shake" value={local.screenShake} onChange={v => handleChange('screenShake', v)} />
        </div>

        {/* Tooltip Mode */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Tooltip Mode</h3>
          <div style={styles.row}>
            {(['plain', 'detailed'] as const).map(m => (
              <button
                key={m}
                style={{ ...styles.optionBtn, backgroundColor: local.tooltipMode === m ? '#2e7d32' : '#333' }}
                onClick={() => handleChange('tooltipMode', m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Key Bindings */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Key Bindings</h3>
          {Object.entries(local.keyBindings).map(([action, code]) => (
            <div key={action} style={styles.bindingRow}>
              <span style={styles.bindingLabel}>{formatAction(action)}</span>
              <button
                style={{
                  ...styles.bindingBtn,
                  backgroundColor: rebindingKey === action ? '#e65100' : '#333',
                }}
                onClick={() => startRebind(action)}
              >
                {rebindingKey === action ? 'Press a key...' : code}
              </button>
            </div>
          ))}
          <button
            style={styles.resetBtn}
            onClick={() => {
              const next = { ...local, keyBindings: { ...DEFAULT_BINDINGS } };
              setLocal(next);
              onSave(next);
            }}
          >
            Reset to Defaults
          </button>
        </div>

        <button style={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div style={styles.toggleRow}>
    <span style={styles.toggleLabel}>{label}</span>
    <button
      style={{ ...styles.toggleBtn, backgroundColor: value ? '#2e7d32' : '#555' }}
      onClick={() => onChange(!value)}
    >
      {value ? 'ON' : 'OFF'}
    </button>
  </div>
);

function formatAction(action: string): string {
  return action.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  panel: { maxWidth: 480, width: '95%', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 24, maxHeight: '85vh', overflowY: 'auto' },
  title: { fontSize: 22, color: '#e0e0e0', fontFamily: 'monospace', margin: '0 0 16px', textAlign: 'center' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 13, color: '#81d4fa', fontFamily: 'monospace', margin: '0 0 8px', borderBottom: '1px solid #333', paddingBottom: 4 },
  row: { display: 'flex', gap: 8 },
  optionBtn: { padding: '6px 16px', border: 'none', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer' },
  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' },
  toggleLabel: { fontSize: 12, color: '#bbb', fontFamily: 'monospace' },
  toggleBtn: { padding: '4px 12px', border: 'none', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', minWidth: 44 },
  bindingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' },
  bindingLabel: { fontSize: 11, color: '#bbb', fontFamily: 'monospace' },
  bindingBtn: { padding: '3px 10px', border: '1px solid #555', borderRadius: 3, color: '#fff', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', minWidth: 80, textAlign: 'center' },
  resetBtn: { marginTop: 8, padding: '4px 12px', backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' },
  closeBtn: { width: '100%', marginTop: 12, padding: '8px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'monospace' },
};
