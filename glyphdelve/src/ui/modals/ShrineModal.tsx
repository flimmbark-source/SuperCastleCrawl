import React, { useState, useMemo } from 'react';
import type { RunState, MeldType } from '../../types';
import { getMeldableItems, previewMeld, executeMeld } from '../../systems/ShrineMeldSystem';
import type { MeldInput, MeldPreview } from '../../systems/ShrineMeldSystem';
import { MELD_COSTS } from '../../types';

interface ShrineModalProps {
  state: RunState;
  onComplete: () => void;
  onStateChange: () => void;
}

export const ShrineModal: React.FC<ShrineModalProps> = ({ state, onComplete, onStateChange }) => {
  const [meldType, setMeldType] = useState<MeldType>('skill_skill');
  const [input1, setInput1] = useState<MeldInput | null>(null);
  const [input2, setInput2] = useState<MeldInput | null>(null);
  const [preview, setPreview] = useState<MeldPreview | null>(null);
  const [message, setMessage] = useState('');

  const meldableItems = useMemo(() => getMeldableItems(state, meldType), [state, meldType]);

  const handleSelectInput = (item: MeldInput, slot: 1 | 2) => {
    if (slot === 1) {
      setInput1(item);
      if (input2) {
        setPreview(previewMeld(state, item, input2, meldType));
      }
    } else {
      setInput2(item);
      if (input1) {
        setPreview(previewMeld(state, input1, item, meldType));
      }
    }
  };

  const handleMeld = () => {
    if (!input1 || !input2 || !preview || !preview.possible) return;
    const success = executeMeld(state, input1, input2, meldType, preview);
    if (success) {
      setMessage(`Created ${preview.outputName}!`);
      setInput1(null);
      setInput2(null);
      setPreview(null);
      onStateChange();
    } else {
      setMessage('Meld failed!');
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>◆ Shrine of Melding</h2>
        <p style={styles.subtitle}>Combine two elements to create something greater</p>
        <p style={styles.essence}>Essence: {state.player.essence}</p>

        <div style={styles.tabs}>
          {(['skill_skill', 'passive_passive', 'item_item'] as MeldType[]).map(type => (
            <button
              key={type}
              style={{
                ...styles.tab,
                backgroundColor: meldType === type ? '#2e7d32' : '#333',
              }}
              onClick={() => { setMeldType(type); setInput1(null); setInput2(null); setPreview(null); }}
            >
              {type.replace('_', ' + ').replace('_', '')}
              <span style={styles.costLabel}> ({MELD_COSTS[type]}◆)</span>
            </button>
          ))}
        </div>

        <div style={styles.meldLayout}>
          {/* Left input */}
          <div style={styles.inputColumn}>
            <h4 style={styles.columnTitle}>Input 1</h4>
            {meldableItems.map(item => (
              <button
                key={`l_${item.id}`}
                style={{
                  ...styles.itemBtn,
                  borderColor: input1?.id === item.id ? '#4fc3f7' : '#444',
                  opacity: input2?.id === item.id ? 0.3 : 1,
                }}
                onClick={() => input2?.id !== item.id && handleSelectInput(item, 1)}
              >
                <span style={styles.itemName}>{item.name}</span>
                <div style={styles.itemTags}>
                  {item.tags.slice(0, 3).map(t => (
                    <span key={t} style={styles.tagChip}>{t}</span>
                  ))}
                </div>
              </button>
            ))}
            {meldableItems.length === 0 && <p style={styles.emptyMsg}>No items available</p>}
          </div>

          {/* Preview */}
          <div style={styles.previewColumn}>
            <h4 style={styles.columnTitle}>Result Preview</h4>
            {preview ? (
              <div style={{
                ...styles.previewCard,
                borderColor: preview.possible ? '#4caf50' : '#f44336',
              }}>
                <div style={styles.previewName}>{preview.outputName}</div>
                <p style={styles.previewDesc}>{preview.outputDescription}</p>
                <div style={styles.previewTags}>
                  {preview.outputTags.map(t => (
                    <span key={t} style={styles.tagChip}>{t}</span>
                  ))}
                </div>
                {preview.inheritedTraits.length > 0 && (
                  <div style={styles.traitSection}>
                    <span style={styles.traitLabel}>Inherited:</span>
                    {preview.inheritedTraits.map((t, i) => (
                      <span key={i} style={styles.traitText}>• {t}</span>
                    ))}
                  </div>
                )}
                {preview.emergentTrait && (
                  <div style={styles.traitSection}>
                    <span style={{ ...styles.traitLabel, color: '#ffd54f' }}>Emergent:</span>
                    <span style={{ ...styles.traitText, color: '#ffd54f' }}>★ {preview.emergentTrait}</span>
                  </div>
                )}
                <div style={styles.costRow}>
                  <span>Cost: {preview.cost}◆</span>
                  {!preview.possible && <span style={styles.errorText}>{preview.reason}</span>}
                </div>
                {preview.possible && (
                  <button style={styles.meldBtn} onClick={handleMeld}>Confirm Meld</button>
                )}
              </div>
            ) : (
              <div style={styles.previewPlaceholder}>Select two items to preview</div>
            )}
          </div>

          {/* Right input */}
          <div style={styles.inputColumn}>
            <h4 style={styles.columnTitle}>Input 2</h4>
            {meldableItems.map(item => (
              <button
                key={`r_${item.id}`}
                style={{
                  ...styles.itemBtn,
                  borderColor: input2?.id === item.id ? '#4fc3f7' : '#444',
                  opacity: input1?.id === item.id ? 0.3 : 1,
                }}
                onClick={() => input1?.id !== item.id && handleSelectInput(item, 2)}
              >
                <span style={styles.itemName}>{item.name}</span>
                <div style={styles.itemTags}>
                  {item.tags.slice(0, 3).map(t => (
                    <span key={t} style={styles.tagChip}>{t}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {message && <p style={styles.message}>{message}</p>}
        <button style={styles.leaveBtn} onClick={onComplete}>Leave Shrine</button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: { maxWidth: 900, width: '95%', textAlign: 'center', maxHeight: '90vh', overflowY: 'auto' },
  title: { fontSize: 24, color: '#ab47bc', fontFamily: 'monospace', margin: '0 0 4px' },
  subtitle: { fontSize: 12, color: '#888', fontFamily: 'monospace', margin: '0 0 4px' },
  essence: { fontSize: 14, color: '#ab47bc', fontFamily: 'monospace', margin: '0 0 12px' },
  tabs: { display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 },
  tab: { padding: '6px 16px', border: 'none', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' as const },
  costLabel: { fontSize: 10, color: '#ab47bc' },
  meldLayout: { display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'flex-start' },
  inputColumn: { width: 220, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  columnTitle: { fontSize: 12, color: '#888', fontFamily: 'monospace', margin: '0 0 6px' },
  itemBtn: { padding: 8, backgroundColor: 'rgba(26,26,46,0.9)', border: '2px solid #444', borderRadius: 6, cursor: 'pointer', textAlign: 'left' as const, display: 'flex', flexDirection: 'column' as const, gap: 3, transition: 'border-color 0.15s' },
  itemName: { fontSize: 12, color: '#e0e0e0', fontFamily: 'monospace', fontWeight: 'bold' as const },
  itemTags: { display: 'flex', gap: 3, flexWrap: 'wrap' as const },
  tagChip: { fontSize: 9, color: '#aaa', backgroundColor: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' },
  emptyMsg: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  previewColumn: { width: 280, minHeight: 200 },
  previewCard: { backgroundColor: 'rgba(26,26,46,0.95)', border: '2px solid #4caf50', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 8, textAlign: 'center' as const },
  previewName: { fontSize: 16, color: '#ffd54f', fontFamily: 'monospace', fontWeight: 'bold' as const },
  previewDesc: { fontSize: 11, color: '#bbb', fontFamily: 'monospace', margin: 0 },
  previewTags: { display: 'flex', gap: 4, flexWrap: 'wrap' as const, justifyContent: 'center' },
  traitSection: { display: 'flex', flexDirection: 'column' as const, gap: 2, textAlign: 'left' as const },
  traitLabel: { fontSize: 10, color: '#81d4fa', fontFamily: 'monospace', fontWeight: 'bold' as const },
  traitText: { fontSize: 10, color: '#bbb', fontFamily: 'monospace', paddingLeft: 8 },
  costRow: { fontSize: 12, color: '#ab47bc', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' as const, gap: 2, alignItems: 'center' },
  errorText: { fontSize: 10, color: '#f44336' },
  meldBtn: { padding: '8px 16px', backgroundColor: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 'bold' as const, cursor: 'pointer', fontFamily: 'monospace' },
  previewPlaceholder: { padding: 40, color: '#555', fontFamily: 'monospace', fontSize: 12, border: '2px dashed #333', borderRadius: 8 },
  message: { fontSize: 13, color: '#4caf50', fontFamily: 'monospace', margin: '12px 0' },
  leaveBtn: { marginTop: 16, padding: '8px 24px', backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' },
};
