import React, { useState } from 'react';
import { getStatusDefinition, getStatusIcon } from '../../data/keywords';

interface StatusIconProps {
  statusId: string;
  stacks?: number;
  duration?: number;
  size?: 'small' | 'medium' | 'large';
}

interface StatusTooltipProps {
  statusId: string;
  stacks?: number;
  duration?: number;
  mouseX: number;
  mouseY: number;
}

const StatusTooltip: React.FC<StatusTooltipProps> = ({
  statusId,
  stacks,
  duration,
  mouseX,
  mouseY
}) => {
  const definition = getStatusDefinition(statusId);

  if (!definition) return null;

  return (
    <div
      className="status-tooltip"
      style={{
        position: 'fixed',
        left: mouseX,
        top: mouseY - 10,
        transform: 'translateY(-100%)',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        border: '1px solid #4a5568',
        borderRadius: '4px',
        padding: '8px 12px',
        maxWidth: '250px',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      <div style={{
        fontWeight: 'bold',
        color: '#fc8181',
        marginBottom: '4px',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ fontSize: '16px' }}>{definition.icon}</span>
        {definition.name}
        {stacks !== undefined && stacks > 1 && (
          <span style={{ fontSize: '12px', color: '#a0aec0' }}>×{stacks}</span>
        )}
      </div>
      <div style={{
        color: '#e2e8f0',
        fontSize: '11px',
        lineHeight: '1.4',
        marginBottom: '4px'
      }}>
        {definition.description}
      </div>
      <div style={{
        color: '#cbd5e0',
        fontSize: '10px',
        lineHeight: '1.3',
        borderTop: '1px solid #4a5568',
        paddingTop: '4px'
      }}>
        {definition.mechanics}
      </div>
      {duration !== undefined && duration > 0 && (
        <div style={{
          color: '#a0aec0',
          fontSize: '10px',
          marginTop: '4px',
          fontStyle: 'italic'
        }}>
          Duration: {(duration / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
};

/**
 * StatusIcon component - displays status effect icon with stack count
 *
 * Usage:
 * <StatusIcon statusId="bleed" stacks={3} />
 * <StatusIcon statusId="stun" />
 *
 * Shows tooltip on hover with full status description
 */
export const StatusIcon: React.FC<StatusIconProps> = ({
  statusId,
  stacks,
  duration,
  size = 'medium'
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const icon = getStatusIcon(statusId);

  const sizeMap = {
    small: { container: 20, icon: 14, text: 10 },
    medium: { container: 24, icon: 16, text: 11 },
    large: { container: 28, icon: 18, text: 12 },
  };

  const dimensions = sizeMap[size];

  const handleMouseEnter = (e: React.MouseEvent) => {
    setShowTooltip(true);
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (showTooltip) {
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <>
      <div
        className="status-icon"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: dimensions.container,
          height: dimensions.container,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          borderRadius: '4px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          cursor: 'help',
          userSelect: 'none',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <span style={{ fontSize: dimensions.icon }}>
          {icon}
        </span>
        {stacks !== undefined && stacks > 1 && (
          <span
            style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              backgroundColor: '#2d3748',
              color: '#fff',
              fontSize: dimensions.text,
              fontWeight: 'bold',
              borderRadius: '3px',
              padding: '0 3px',
              lineHeight: '1.2',
              minWidth: '14px',
              textAlign: 'center',
              border: '1px solid rgba(255, 255, 255, 0.3)',
            }}
          >
            {stacks}
          </span>
        )}
      </div>
      {showTooltip && (
        <StatusTooltip
          statusId={statusId}
          stacks={stacks}
          duration={duration}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
        />
      )}
    </>
  );
};

export default StatusIcon;
