import React, { useState } from 'react';
import type { LevelUpOffer, Tag, SynergyRating } from '../../types';

interface LevelUpModalProps {
  offers: LevelUpOffer[];
  playerLevel: number;
  onChoose: (offerId: string) => void;
  tooltipMode: 'plain' | 'detailed';
}

export const LevelUpModal: React.FC<LevelUpModalProps> = ({ offers, playerLevel, onChoose, tooltipMode }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>Level Up! → Level {playerLevel}</h2>
        <p style={styles.subtitle}>Choose one of 5 options to add to your build:</p>
        <div style={styles.cardRow}>
          {offers.map(offer => (
            <OfferCard
              key={offer.id}
              offer={offer}
              expanded={expandedId === offer.id}
              onToggleExpand={() => setExpandedId(expandedId === offer.id ? null : offer.id)}
              onChoose={() => onChoose(offer.id)}
              tooltipMode={tooltipMode}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface OfferCardProps {
  offer: LevelUpOffer;
  expanded: boolean;
  onToggleExpand: () => void;
  onChoose: () => void;
  tooltipMode: 'plain' | 'detailed';
}

const OfferCard: React.FC<OfferCardProps> = ({ offer, expanded, onToggleExpand, onChoose, tooltipMode }) => {
  const synergyColor = offer.synergy === 'High' ? '#4caf50' : offer.synergy === 'Med' ? '#ffc107' : '#9e9e9e';
  const typeColor = offer.type === 'skill' ? '#4fc3f7' : offer.type === 'skill_upgrade' ? '#ff9800' : '#ab47bc';
  const typeLabel = offer.type === 'skill' ? 'SKILL' : offer.type === 'skill_upgrade' ? 'UPGRADE' : 'PASSIVE';
  const rarityColor = offer.rarity === 'Common' ? '#9e9e9e' : offer.rarity === 'Uncommon' ? '#4fc3f7' : '#ff9800';

  return (
    <div style={{
      ...styles.card,
      borderColor: synergyColor,
    }}>
      {/* Type badge */}
      <div style={{ ...styles.typeBadge, backgroundColor: typeColor }}>{typeLabel}</div>
      <div style={{ ...styles.rarityBadge, color: rarityColor }}>{offer.rarity}</div>

      <div style={styles.cardTitleRow}>
        <span style={styles.cardIcon}>{offer.icon}</span>
        <h3 style={styles.cardTitle}>{offer.name}</h3>
      </div>

      {/* Information hierarchy: 1. Plain effect, 2. Tags, 3. Trigger, 4. Numbers, 5. Synergy */}
      <p style={styles.cardDesc}>{offer.description}</p>

      {/* Tags */}
      <div style={styles.tagRow}>
        {offer.tags.map(t => (
          <span key={t} style={styles.tag}>{t}</span>
        ))}
      </div>

      {/* Trigger sentence */}
      <p style={styles.triggerText}>{offer.triggerSentence}</p>

      {/* Synergy indicator */}
      <div style={{ ...styles.synergyBadge, backgroundColor: synergyColor }}>
        Synergy: {offer.synergy}
        <span style={styles.synergyIcon}>
          {offer.synergy === 'High' ? ' ★★★' : offer.synergy === 'Med' ? ' ★★' : ' ★'}
        </span>
      </div>

      {/* Expandable details */}
      {tooltipMode === 'detailed' && (
        <button onClick={onToggleExpand} style={styles.expandBtn}>
          {expanded ? '▲ Less' : '▼ Details'}
        </button>
      )}
      {expanded && (
        <div style={styles.expandedSection}>
          <p style={styles.detailText}>{offer.synergyNote}</p>
          <p style={styles.detailText}>Weight: {offer.finalWeight.toFixed(2)}</p>
        </div>
      )}

      <button onClick={onChoose} style={styles.chooseBtn}>Choose</button>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: '20px 24px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  title: {
    color: '#ffd54f',
    fontFamily: 'monospace',
    fontSize: 20,
    margin: '0 0 4px',
    textAlign: 'center',
  },
  subtitle: {
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center',
    margin: '0 0 16px',
  },
  cardRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  card: {
    width: 170,
    backgroundColor: '#252538',
    border: '2px solid #555',
    borderRadius: 8,
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    position: 'relative',
  },
  typeBadge: {
    display: 'inline-block',
    fontSize: 9,
    fontWeight: 'bold',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: 3,
    fontFamily: 'monospace',
    alignSelf: 'flex-start',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rarityBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  cardIcon: {
    fontSize: 22,
    lineHeight: 1,
    flexShrink: 0,
  },
  cardTitle: {
    color: '#e0e0e0',
    fontFamily: 'monospace',
    fontSize: 13,
    margin: 0,
  },
  cardDesc: {
    color: '#bbb',
    fontFamily: 'monospace',
    fontSize: 10,
    margin: 0,
    lineHeight: 1.4,
  },
  tagRow: {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
  },
  tag: {
    fontSize: 9,
    color: '#ddd',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: '1px 5px',
    borderRadius: 3,
    fontFamily: 'monospace',
  },
  triggerText: {
    color: '#90caf9',
    fontFamily: 'monospace',
    fontSize: 9,
    margin: 0,
    fontStyle: 'italic',
  },
  synergyBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 10,
    color: '#000',
    padding: '2px 8px',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  synergyIcon: {
    marginLeft: 2,
    fontSize: 10,
  },
  expandBtn: {
    background: 'none',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontSize: 9,
    fontFamily: 'monospace',
    cursor: 'pointer',
    padding: '2px 6px',
    alignSelf: 'flex-start',
  },
  expandedSection: {
    borderTop: '1px solid #333',
    paddingTop: 6,
  },
  detailText: {
    color: '#777',
    fontFamily: 'monospace',
    fontSize: 9,
    margin: '2px 0',
  },
  chooseBtn: {
    marginTop: 'auto',
    padding: '6px 12px',
    backgroundColor: '#4fc3f7',
    color: '#000',
    border: 'none',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    fontSize: 12,
    cursor: 'pointer',
  },
};
