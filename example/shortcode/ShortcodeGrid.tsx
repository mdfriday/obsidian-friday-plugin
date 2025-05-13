import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ShortcodeItem } from '@/types/shortcode';
import ShortcodeCard from './ShortcodeCard';

interface ShortcodeGridProps {
  shortcodes: ShortcodeItem[];
  selectedShortcode?: ShortcodeItem | null;
  onShortcodeSelect: (shortcode: ShortcodeItem) => void;
  emptyMessage?: string;
  isLoading?: boolean;
}

/**
 * ShortcodeGrid - 显示模板的网格布局
 * 
 * 以网格形式展示模板卡片，支持选中状态，自适应布局
 */
const ShortcodeGrid: React.FC<ShortcodeGridProps> = ({
  shortcodes,
  selectedShortcode,
  onShortcodeSelect,
  emptyMessage = '没有找到模板',
  isLoading = false
}) => {
  const [isLayouting, setIsLayouting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const layoutTimeoutRef = useRef<number | null>(null);
  
  // 计算首屏可见项，用于预加载优化
  const visibleItems = useMemo(() => {
    return shortcodes.slice(0, 9); // 通常首屏最多显示9个项目
  }, [shortcodes]);

  // 判断项目是否在首屏可见
  const isItemPrefetched = (shortcode: ShortcodeItem) => {
    return visibleItems.some(item => item.id === shortcode.id);
  };
  
  // 设置重新布局时的过渡效果
  useEffect(() => {
    if (typeof ResizeObserver !== 'undefined') {
      const handleResize = (entries: ResizeObserverEntry[]) => {
        if (!entries.length) return;
        
        if (layoutTimeoutRef.current) {
          window.clearTimeout(layoutTimeoutRef.current);
        }
        
        layoutTimeoutRef.current = window.setTimeout(() => {
          setIsLayouting(true);
          
          layoutTimeoutRef.current = window.setTimeout(() => {
            setIsLayouting(false);
          }, 50);
        }, 100);
      };
      
      resizeObserverRef.current = new ResizeObserver(handleResize);
      
      if (gridRef.current) {
        resizeObserverRef.current.observe(gridRef.current);
      }
      
      return () => {
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
        }
        if (layoutTimeoutRef.current) {
          clearTimeout(layoutTimeoutRef.current);
        }
      };
    }
  }, []);

  if (shortcodes.length === 0 && !isLoading) {
    return (
      <div className="flex justify-center items-center py-12 text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  const layoutClass = isLayouting ? 'masonry-grid-layouting' : '';

  return (
    <div 
      ref={gridRef}
      className={`w-full ${layoutClass}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '1.5rem',
        justifyContent: 'center',
        containIntrinsicSize: 'auto',
        contain: 'paint layout style'
      }}
    >
      {shortcodes.map((shortcode) => (
        <div
          key={shortcode.id}
          style={{ 
            willChange: isLayouting ? 'transform' : 'auto', 
            contain: 'content',
            transform: 'translateZ(0)'
          }}
        >
          <ShortcodeCard
            shortcode={shortcode}
            isSelected={selectedShortcode?.id === shortcode.id}
            onClick={onShortcodeSelect}
            prefetched={isItemPrefetched(shortcode)}
          />
        </div>
      ))}
    </div>
  );
};

export default ShortcodeGrid; 