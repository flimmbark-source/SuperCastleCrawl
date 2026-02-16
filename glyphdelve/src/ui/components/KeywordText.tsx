import React, { useState } from 'react';
import { getKeywordDefinition, KEYWORD_MAP } from '../../data/keywords';

interface KeywordTextProps {
  text: string;
  className?: string;
}

interface TooltipProps {
  keyword: string;
  mouseX: number;
  mouseY: number;
}

const KeywordTooltip: React.FC<TooltipProps> = ({ keyword, mouseX, mouseY }) => {
  const definition = getKeywordDefinition(keyword);

  if (!definition) return null;

  return (
    <div
      className="keyword-tooltip"
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
        color: '#63b3ed',
        marginBottom: '4px',
        fontSize: '13px'
      }}>
        {definition.keyword}
      </div>
      <div style={{
        color: '#e2e8f0',
        fontSize: '12px',
        lineHeight: '1.4'
      }}>
        {definition.definition}
      </div>
      {definition.example && (
        <div style={{
          color: '#a0aec0',
          fontSize: '11px',
          marginTop: '4px',
          fontStyle: 'italic'
        }}>
          Ex: {definition.example}
        </div>
      )}
    </div>
  );
};

/**
 * KeywordText component - parses text and highlights keywords with tooltips
 *
 * Usage:
 * <KeywordText text="Your Move is a Leap: Arc trajectory with +60% GCD" />
 *
 * Any word matching a keyword in KEYWORD_MAP will be highlighted and show a tooltip on hover
 */
export const KeywordText: React.FC<KeywordTextProps> = ({ text, className = '' }) => {
  const [hoveredKeyword, setHoveredKeyword] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Parse text and identify keywords
  const parseText = (input: string) => {
    const parts: Array<{ text: string; isKeyword: boolean; keyword?: string }> = [];

    // Simple word-by-word parsing
    const words = input.split(/(\s+)/); // Keep spaces

    for (const word of words) {
      const cleanWord = word.toLowerCase().trim();
      const normalizedKeyword = KEYWORD_MAP[cleanWord];

      if (normalizedKeyword) {
        parts.push({ text: word, isKeyword: true, keyword: normalizedKeyword });
      } else {
        // Check for multi-word keywords
        let matched = false;
        for (const [key, value] of Object.entries(KEYWORD_MAP)) {
          if (key.includes(' ') && input.toLowerCase().includes(key)) {
            // This is a simplified approach - full implementation would need proper tokenization
            parts.push({ text: word, isKeyword: false });
            matched = true;
            break;
          }
        }
        if (!matched) {
          parts.push({ text: word, isKeyword: false });
        }
      }
    }

    return parts;
  };

  const parts = parseText(text);

  const handleMouseEnter = (keyword: string, e: React.MouseEvent) => {
    setHoveredKeyword(keyword);
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (hoveredKeyword) {
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseLeave = () => {
    setHoveredKeyword(null);
  };

  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.isKeyword && part.keyword) {
          return (
            <span
              key={idx}
              className="keyword-highlight"
              style={{
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
                textUnderlineOffset: '2px',
                color: '#63b3ed',
                cursor: 'help',
              }}
              onMouseEnter={(e) => handleMouseEnter(part.keyword!, e)}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {part.text}
            </span>
          );
        }
        return <span key={idx}>{part.text}</span>;
      })}
      {hoveredKeyword && (
        <KeywordTooltip
          keyword={hoveredKeyword}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
        />
      )}
    </span>
  );
};

export default KeywordText;
