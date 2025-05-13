import { memo, useState, useEffect, useRef } from 'react';
import type { ShortcodeItem } from '@/types/shortcode';
import { getShortcodeThumbnailUrl } from '@/core/utils/shortcodeUtils';
import Popover, { PopoverPosition } from '@/components/ui/Popover';
import { calculateBestPosition } from '@/core/utils/popoverUtils';
import '@/styles/modal.css';

interface ShortcodeCardProps {
  shortcode: ShortcodeItem;
  isSelected: boolean;
  onClick: (shortcode: ShortcodeItem) => void;
  prefetched?: boolean;
}

const ShortcodeCard = ({ 
  shortcode, 
  isSelected, 
  onClick, 
  prefetched = false 
}: ShortcodeCardProps) => {
  const { id, title, description, tags, asset, width, height } = shortcode;
  
  // Get the thumbnail display information using our utility function
  const thumbnailInfo = getShortcodeThumbnailUrl(
    id, 
    asset, 
    width, 
    height,
    300, // Max card width
    200  // Max card height
  );
  
  const [isLoaded, setIsLoaded] = useState(prefetched);
  const [isVisible, setIsVisible] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Handle click with a small performance optimization
  const handleClick = () => {
    onClick(shortcode);
  };

  // Handle image load event
  const handleImageLoad = () => {
    setIsLoaded(true);
  };
  
  // Handle mouse enter/leave for popover
  const handleMouseEnter = () => {
    if (isVisible && cardRef.current) {
      updatePopoverPosition();
      setShowPopover(true);
    }
  };

  const handleMouseLeave = () => {
    setShowPopover(false);
  };
  
  // Update the popover position based on the card position
  const updatePopoverPosition = () => {
    if (!cardRef.current) return;
    
    const triggerRect = cardRef.current.getBoundingClientRect();
    const position = calculateBestPosition({ triggerRect });
    setPopoverPosition(position);
  };
  
  // Update popover position when window is resized
  useEffect(() => {
    if (showPopover) {
      const handleResize = () => {
        updatePopoverPosition();
      };
      
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleResize);
      };
    }
  }, [showPopover]);
  
  // Load the image only when component is visible
  useEffect(() => {
    if (prefetched) {
      // If already prefetched, mark as loaded immediately
      setIsLoaded(true);
      return;
    }
    
    // If the card is visible and image isn't loaded yet, load it
    if (isVisible && !isLoaded && imageRef.current) {
      // Create a persistent image to avoid GC during scrolling
      const imgElement = new window.Image();
      imgElement.crossOrigin = "anonymous";
      imgElement.onload = handleImageLoad;
      imgElement.onerror = () => {
        console.error(`Failed to load image: ${thumbnailInfo.url}`);
      };
      imgElement.src = thumbnailInfo.url;
      
      return () => {
        imgElement.onload = null;
        imgElement.onerror = null;
      };
    }
  }, [thumbnailInfo.url, isVisible, isLoaded, prefetched]);
  
  // Use Intersection Observer to track visibility for efficient loading
  useEffect(() => {
    // Skip visibility detection if already prefetched and loaded
    if (prefetched) {
      setIsVisible(true);
      return;
    }
    
    const currentRef = cardRef.current;
    if (!currentRef) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
          // Once visible, stop observing to reduce overhead
          observer.unobserve(currentRef);
        }
      },
      {
        rootMargin: '200px', // Load images a bit before they enter viewport
        threshold: 0.01,
      }
    );
    
    observer.observe(currentRef);
    
    return () => {
      observer.unobserve(currentRef);
      observer.disconnect();
    };
  }, [prefetched]);

  // The card padding value
  const cardPadding = 16; // 8px on each side
  
  return (
    <div 
      ref={cardRef}
      className={`relative group overflow-hidden rounded-lg shadow-md bg-white transition-all hover:shadow-xl hover:-translate-y-1 cursor-pointer optimized-card ${
        isSelected ? 'ring-2 ring-blue-500 border-blue-500' : 'border border-gray-200'
      }`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ 
        // Set the card's fixed width to the thumbnail width plus padding
        width: thumbnailInfo.displayWidth > 0 
          ? thumbnailInfo.displayWidth + (cardPadding * 2) 
          : 'auto'
      }}
    >
      {/* Image container with fixed height */}
      <div 
        className="relative overflow-hidden optimized-card-image-container" 
        style={{ 
          height: thumbnailInfo.displayHeight > 0 
            ? thumbnailInfo.displayHeight + cardPadding
            : 0,
          padding: cardPadding / 2
        }}
      >
        {!isLoaded && (
          <div className="absolute inset-0 bg-gray-100 animate-pulse optimized-card-loading"></div>
        )}
        
        {/* The image itself - use original dimensions */}
        {(isVisible || prefetched) && (
          <img
            ref={imageRef}
            src={thumbnailInfo.url}
            alt={title}
            className={`transition-opacity duration-300 optimized-card-image ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading={prefetched ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={handleImageLoad}
            width={thumbnailInfo.displayWidth}
            height={thumbnailInfo.displayHeight}
            style={{ 
              display: 'block',
              margin: '0 auto',
              objectFit: 'contain',
              maxWidth: '100%',
              maxHeight: '100%'
            }}
          />
        )}
      </div>
      
      {/* 简单信息提示 - 显示标题 */}
      {isVisible && (
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-0 left-0 right-0 p-3 transform translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
            <h3 className="text-white font-semibold text-base line-clamp-1">{title}</h3>
            
            {/* 简单的标签提示 - 只显示数量 */}
            {tags.length > 0 && (
              <div className="mt-1 text-xs text-gray-200">
                {tags.length} 个标签
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 使用共享的 Popover 组件 */}
      <Popover
        isVisible={isVisible && showPopover}
        position={popoverPosition}
        zIndex={50}
      >
        <h3 className="font-semibold text-lg text-white">{title}</h3>
        
        {description && (
          <div className="mt-2 max-h-48 overflow-y-auto custom-scrollbar">
            <p className="text-gray-200 text-sm whitespace-pre-line">{description}</p>
          </div>
        )}
        
        {/* 完整标签列表 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {tags.map((tag) => (
              <span 
                key={tag} 
                className="text-xs px-2 py-1 bg-white/20 text-white rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        
        {/* 尺寸信息 */}
        <div className="mt-3 text-xs text-gray-300">
          {width} × {height}
        </div>
      </Popover>
    </div>
  );
};

// Add memoization to prevent unnecessary re-renders
export default memo(ShortcodeCard); 