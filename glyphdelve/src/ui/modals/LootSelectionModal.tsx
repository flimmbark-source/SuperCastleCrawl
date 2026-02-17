import React from 'react';
import type { ItemDef, Rarity } from '../../types';
import { KeywordText } from '../components/KeywordText';

interface LootOffer {
  def: ItemDef;
}

interface LootSelectionModalProps {
  offers: LootOffer[];
  onChoose: (itemId: string) => void;
  onSkip: () => void;
  essenceReward: number;
}

export const LootSelectionModal: React.FC<LootSelectionModalProps> = ({
  offers,
  onChoose,
  onSkip,
  essenceReward
}) => {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>Choose Your Reward (1 of 3)</h2>
        <p style={styles.subtitle}>Select one item to add to your inventory, or skip for essence:</p>

        <div style={styles.cardRow}>
          {offers.map(offer => (
            <ItemCard
              key={offer.def.id}
              item={offer.def}
              onChoose={() => onChoose(offer.def.id)}
            />
          ))}
        </div>

        <div style={styles.skipSection}>
          <button onClick={onSkip} style={styles.skipBtn}>
            Skip All for +{essenceReward} Essence
          </button>
        </div>
      </div>
    </div>
  );
};

interface ItemCardProps {
  item: ItemDef;
  onChoose: () => void;
}

const ItemCard: React.FC<ItemCardProps> = ({ item, onChoose }) => {
  const rarityColor = getRarityColor(item.rarity);
  const slotColor = getSlotColor(item.slot);

  // Get item icon based on slot
  const getItemIcon = (slot: string) => {
    switch (slot) {
      case 'weapon': return '⚔️';
      case 'armor': return '🛡️';
      case 'accessory': return '💍';
      case 'relic': return '✨';
      default: return '📦';
    }
  };

  return (
    <div style={{
      ...styles.card,
      borderColor: rarityColor,
    }}>
      {/* Slot badge */}
      <div style={{ ...styles.slotBadge, backgroundColor: slotColor }}>
        {item.slot.toUpperCase()}
      </div>
      <div style={{ ...styles.rarityBadge, color: rarityColor }}>
        {item.rarity}
      </div>

      {/* Item icon */}
      <div style={styles.itemIcon}>
        {getItemIcon(item.slot)}
      </div>

      <h3 style={styles.cardTitle}>{item.name}</h3>

      {/* Description with keyword highlighting */}
      <div style={styles.cardDesc}>
        <KeywordText text={item.description} />
      </div>

      {/* Tags */}
      <div style={styles.tagRow}>
        {item.tags.map(t => (
          <span key={t} style={styles.tag}>{t}</span>
        ))}
      </div>

      {/* Trigger sentence */}
      <p style={styles.triggerText}>
        <KeywordText text={item.triggerSentence} />
      </p>

      {/* Synergy note */}
      <p style={styles.synergyNote}>{item.synergyNote}</p>

      <button onClick={onChoose} style={styles.chooseBtn}>SELECT</button>
    </div>
  );
};

// Helper functions
function getRarityColor(rarity: Rarity): string {
  switch (rarity) {
    case 'Common': return '#9e9e9e';
    case 'Uncommon': return '#4fc3f7';
    case 'Rare': return '#ff9800';
    case 'Relic': return '#e91e63';
    default: return '#9e9e9e';
  }
}

function getSlotColor(slot: string): string {
  switch (slot) {
    case 'weapon': return '#f44336';
    case 'armor': return '#2196f3';
    case 'accessory': return '#9c27b0';
    case 'relic': return '#ff9800';
    default: return '#607d8b';
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1a202c',
    border: '2px solid #4a5568',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#f7fafc',
    marginBottom: '8px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '14px',
    color: '#a0aec0',
    marginBottom: '20px',
    textAlign: 'center',
  },
  cardRow: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: '20px',
  },
  card: {
    backgroundColor: '#2d3748',
    border: '2px solid',
    borderRadius: '6px',
    padding: '16px',
    width: '280px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  slotBadge: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    padding: '4px 8px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#fff',
  },
  rarityBadge: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    fontSize: '11px',
    fontWeight: 'bold',
  },
  itemIcon: {
    fontSize: '40px',
    textAlign: 'center',
    marginTop: '20px',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#f7fafc',
    textAlign: 'center',
    marginBottom: '8px',
  },
  cardDesc: {
    fontSize: '13px',
    color: '#e2e8f0',
    lineHeight: '1.4',
    marginBottom: '8px',
    minHeight: '40px',
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginBottom: '8px',
  },
  tag: {
    fontSize: '9px',
    padding: '2px 6px',
    backgroundColor: '#4a5568',
    color: '#e2e8f0',
    borderRadius: '3px',
    fontWeight: 'bold',
  },
  triggerText: {
    fontSize: '11px',
    color: '#90cdf4',
    fontStyle: 'italic',
    lineHeight: '1.3',
    marginBottom: '8px',
  },
  synergyNote: {
    fontSize: '10px',
    color: '#a0aec0',
    lineHeight: '1.3',
    marginBottom: '12px',
    borderTop: '1px solid #4a5568',
    paddingTop: '8px',
  },
  chooseBtn: {
    padding: '10px',
    backgroundColor: '#4299e1',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    marginTop: 'auto',
  },
  skipSection: {
    textAlign: 'center',
    paddingTop: '12px',
    borderTop: '1px solid #4a5568',
  },
  skipBtn: {
    padding: '12px 24px',
    backgroundColor: '#718096',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};

export default LootSelectionModal;
