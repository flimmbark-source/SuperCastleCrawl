import React from 'react';
import type { PlayerEntity, RunState, ActiveSkill, ActiveItem, Tag } from '../../types';

interface HUDProps {
  player: PlayerEntity;
  state: RunState;
  floor: number;
  nodeIndex: number;
}

export const HUD: React.FC<HUDProps> = ({ player, state, floor, nodeIndex }) => {
  const hpPercent = (player.hp / player.maxHp) * 100;
  const xpPercent = (player.xp / player.xpToNext) * 100;
  const resourcePercent = (player.resource / player.maxResource) * 100;
  const latestTurnEntry = [...state.combatLog].reverse().find(entry => entry.source === 'system' && entry.details.includes('turn'));

  return (
    <>
      {/* Top-left: Health/Resource/Status */}
      <div style={styles.topLeft}>
        <div style={styles.barContainer}>
          <div style={styles.barLabel}>HP {Math.ceil(player.hp)}/{player.maxHp}</div>
          <div style={styles.barBg}>
            <div style={{ ...styles.barFill, width: `${hpPercent}%`, backgroundColor: '#4caf50' }} />
          </div>
        </div>
        <div style={styles.barContainer}>
          <div style={styles.barLabel}>XP Lv{player.level} ({Math.floor(player.xp)}/{player.xpToNext})</div>
          <div style={styles.barBg}>
            <div style={{ ...styles.barFill, width: `${xpPercent}%`, backgroundColor: '#ffd54f' }} />
          </div>
        </div>
        <div style={styles.barContainer}>
          <div style={styles.barLabel}>Resource {Math.ceil(player.resource)}/{player.maxResource}</div>
          <div style={styles.barBg}>
            <div style={{ ...styles.barFill, width: `${resourcePercent}%`, backgroundColor: '#42a5f5' }} />
          </div>
        </div>
        <div style={styles.essenceLabel}>
          ◆ Essence: {player.essence}
        </div>
        <div style={styles.floorLabel}>
          Floor {floor} · Node {nodeIndex + 1}/9
        </div>
        <div style={styles.timeLabel}>
          {formatTime(state.runTime)} · Kills: {state.killCount}
        </div>
        <div style={styles.turnLabel}>
          {latestTurnEntry?.details ?? 'Player turn'}
        </div>
      </div>

      {/* Bottom-center: Skill hotbar */}
      <div style={styles.hotbar}>
        {player.skills.map((skill, i) => (
          <SkillSlot key={skill.def.id} skill={skill} index={i} />
        ))}
        {Array.from({ length: player.maxSkillSlots - player.skills.length }).map((_, i) => (
          <div key={`empty_${i}`} style={styles.emptySlot}>
            <span style={styles.emptyText}>{i + player.skills.length + 1}</span>
          </div>
        ))}
      </div>

      {/* Item cooldown bar (only items with cooldowns) */}
      {player.items.filter(i => i.def.cooldown > 0).length > 0 && (
        <div style={styles.itemBar}>
          {player.items.filter(i => i.def.cooldown > 0).map(item => (
            <ItemSlot key={item.def.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
};

const SkillSlot: React.FC<{ skill: ActiveSkill; index: number }> = ({ skill, index }) => {
  const onCooldown = skill.cooldownRemaining > 0;
  const cdPercent = onCooldown ? (skill.cooldownRemaining / skill.def.cooldown) * 100 : 0;

  return (
    <div style={{
      ...styles.skillSlot,
      opacity: onCooldown ? 0.6 : 1,
      borderColor: onCooldown ? '#555' : '#4fc3f7',
    }}
    title={`${skill.def.name}\n${skill.def.description}\nTags: ${skill.def.tags.join(', ')}`}
    >
      <div style={styles.skillKey}>{index + 1}</div>
      <div style={styles.skillIcon}>{skill.def.icon}</div>
      <div style={styles.skillName}>{skill.def.name.split(' ').map(w => w[0]).join('')}</div>
      {onCooldown && (
        <div style={{
          ...styles.cooldownOverlay,
          height: `${cdPercent}%`,
        }} />
      )}
      {onCooldown && (
        <div style={styles.cooldownText}>{skill.cooldownRemaining.toFixed(1)}</div>
      )}
      {/* Tag chips */}
      <div style={styles.tagRow}>
        {skill.def.tags.slice(0, 2).map(t => (
          <span key={t} style={styles.miniTag}>{t.slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
};

const ItemSlot: React.FC<{ item: ActiveItem }> = ({ item }) => {
  const onCooldown = item.cooldownRemaining > 0;
  const cdPercent = onCooldown ? (item.cooldownRemaining / item.def.cooldown) * 100 : 0;

  return (
    <div style={{
      ...styles.itemSlot,
      opacity: onCooldown ? 0.5 : 1,
      borderColor: onCooldown ? '#555' : '#ab47bc',
    }}
    title={`${item.def.name}\n${item.def.triggerSentence}\nCooldown: ${item.def.cooldown}s`}
    >
      <div style={styles.itemIcon}>{item.def.icon}</div>
      <div style={styles.itemName}>{item.def.name.split(' ').map(w => w[0]).join('')}</div>
      {onCooldown && (
        <div style={{
          ...styles.cooldownOverlay,
          height: `${cdPercent}%`,
        }} />
      )}
      {onCooldown && (
        <div style={styles.itemCdText}>{item.cooldownRemaining.toFixed(0)}s</div>
      )}
      {!onCooldown && (
        <div style={styles.itemReady}>READY</div>
      )}
    </div>
  );
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles: Record<string, React.CSSProperties> = {
  topLeft: {
    position: 'absolute',
    top: 8,
    left: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    pointerEvents: 'none',
    zIndex: 10,
  },
  barContainer: {
    width: 200,
  },
  barLabel: {
    fontSize: 11,
    color: '#ccc',
    fontFamily: 'monospace',
    marginBottom: 1,
  },
  barBg: {
    width: '100%',
    height: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
    border: '1px solid #333',
  },
  barFill: {
    height: '100%',
    transition: 'width 0.2s',
    borderRadius: 2,
  },
  essenceLabel: {
    fontSize: 12,
    color: '#ab47bc',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  floorLabel: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'monospace',
  },
  timeLabel: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
  },
  turnLabel: {
    fontSize: 11,
    color: '#fff59d',
    fontFamily: 'monospace',
  },
  hotbar: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 6,
    zIndex: 10,
  },
  skillSlot: {
    width: 56,
    height: 56,
    backgroundColor: 'rgba(20, 20, 40, 0.9)',
    border: '2px solid #4fc3f7',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
  },
  skillKey: {
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: 9,
    color: '#888',
    fontFamily: 'monospace',
  },
  skillIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
  skillName: {
    fontSize: 8,
    color: '#aaa',
    fontFamily: 'monospace',
  },
  cooldownOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  cooldownText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  tagRow: {
    position: 'absolute',
    bottom: 2,
    display: 'flex',
    gap: 2,
  },
  miniTag: {
    fontSize: 7,
    color: '#aaa',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: '0 2px',
    borderRadius: 2,
    fontFamily: 'monospace',
  },
  itemBar: {
    position: 'absolute',
    bottom: 76,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 4,
    zIndex: 10,
  },
  itemSlot: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(20, 20, 40, 0.9)',
    border: '2px solid #ab47bc',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  itemIcon: {
    fontSize: 16,
    lineHeight: 1,
  },
  itemName: {
    fontSize: 7,
    color: '#aaa',
    fontFamily: 'monospace',
  },
  itemCdText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 11,
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  itemReady: {
    position: 'absolute',
    bottom: 1,
    fontSize: 6,
    color: '#4caf50',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  emptySlot: {
    width: 56,
    height: 56,
    backgroundColor: 'rgba(20, 20, 40, 0.5)',
    border: '2px dashed #333',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#444',
    fontFamily: 'monospace',
  },
};
