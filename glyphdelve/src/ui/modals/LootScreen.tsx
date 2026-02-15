import React, { useState, useRef } from 'react';
import type { EncounterLootEntry } from '../../types';

interface LootScreenProps {
  items: EncounterLootEntry[];
  onContinue: () => void;
}

const RARITY_COLORS: Record<string, string> = {
  Common: '#9e9e9e',
  Uncommon: '#4fc3f7',
  Rare: '#ff9800',
  Legendary: '#e040fb',
};

const RARITY_BORDER: Record<string, string> = {
  Common: '#555',
  Uncommon: '#1e88e5',
  Rare: '#e65100',
  Legendary: '#aa00ff',
};

const RARITY_GLOW: Record<string, string> = {
  Common: 'none',
  Uncommon: '0 0 8px rgba(79,195,247,0.3)',
  Rare: '0 0 12px rgba(255,152,0,0.4)',
  Legendary: '0 0 16px rgba(224,64,251,0.5)',
};

export const LootScreen: React.FC<LootScreenProps> = ({ items, onContinue }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>Loot Secured</h2>
        <p style={styles.subtitle}>
          {items.length} item{items.length === 1 ? '' : 's'} found — hover to inspect
        </p>

        <div style={styles.itemGrid}>
          {items.map((item, idx) => {
            const rarityColor = RARITY_COLORS[item.rarity] || '#9e9e9e';
            const borderColor = RARITY_BORDER[item.rarity] || '#555';
            const glow = RARITY_GLOW[item.rarity] || 'none';
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={`${item.id}_${idx}`}
                ref={el => { cardRefs.current[idx] = el; }}
                style={{
                  ...styles.itemCard,
                  borderColor: isHovered ? rarityColor : borderColor,
                  boxShadow: isHovered ? glow : 'none',
                  transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                  backgroundColor: isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.3)',
                }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div style={styles.itemIcon}>{item.icon}</div>
                <div style={{ ...styles.itemName, color: rarityColor }}>{item.name}</div>
              </div>
            );
          })}
        </div>

        {hoveredIdx !== null && items[hoveredIdx] && (
          <ItemTooltip item={items[hoveredIdx]} />
        )}

        <button style={styles.continueBtn} onClick={onContinue}>
          Continue Delve
        </button>
      </div>
    </div>
  );
};

const ItemTooltip: React.FC<{ item: EncounterLootEntry }> = ({ item }) => {
  const rarityColor = RARITY_COLORS[item.rarity] || '#9e9e9e';
  const borderColor = RARITY_BORDER[item.rarity] || '#555';

  return (
    <div style={{ ...styles.tooltip, borderColor }}>
      <div style={styles.tooltipHeader}>
        <span style={styles.tooltipIcon}>{item.icon}</span>
        <div>
          <div style={{ ...styles.tooltipName, color: rarityColor }}>{item.name}</div>
          <div style={styles.tooltipMeta}>
            <span style={{ color: rarityColor }}>{item.rarity}</span>
            {item.slot && <span style={styles.tooltipSlot}>{item.slot}</span>}
          </div>
        </div>
      </div>
      <div style={styles.tooltipDivider} />
      <div style={styles.tooltipDesc}>{item.description}</div>
      {item.effectSummary && (
        <div style={styles.tooltipEffect}>{item.effectSummary}</div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    maxWidth: 540,
    width: '90%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: '28px 32px',
    textAlign: 'center',
    border: '2px solid #333',
    position: 'relative',
  },
  title: {
    fontSize: 22,
    color: '#ffd54f',
    fontFamily: 'monospace',
    margin: '0 0 4px',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#777',
    fontFamily: 'monospace',
    margin: '0 0 20px',
  },
  itemGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  itemCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    width: 88,
    height: 88,
    borderRadius: 8,
    border: '2px solid #555',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    padding: 6,
  },
  itemIcon: {
    fontSize: 28,
    lineHeight: '1',
    marginBottom: 4,
  },
  itemName: {
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center' as const,
    lineHeight: '1.2',
    maxWidth: 76,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  tooltip: {
    backgroundColor: '#12121f',
    border: '2px solid #555',
    borderRadius: 8,
    padding: '12px 16px',
    textAlign: 'left' as const,
    marginBottom: 16,
    minHeight: 80,
  },
  tooltipHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  tooltipIcon: {
    fontSize: 32,
    lineHeight: '1',
  },
  tooltipName: {
    fontSize: 15,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  tooltipMeta: {
    display: 'flex',
    gap: 8,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  tooltipSlot: {
    color: '#888',
    textTransform: 'capitalize' as const,
  },
  tooltipDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    margin: '8px 0',
  },
  tooltipDesc: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#aab6d1',
    lineHeight: '1.5',
    marginBottom: 6,
  },
  tooltipEffect: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#90caf9',
    lineHeight: '1.4',
  },
  continueBtn: {
    padding: '10px 32px',
    backgroundColor: '#2e7d32',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
};
