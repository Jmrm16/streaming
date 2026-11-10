import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SheetContextType {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SheetContext = React.createContext<SheetContextType>({
  open: false,
  onOpenChange: () => {},
});

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({ open = false, onOpenChange = () => {}, children }) => {
  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetContext.Provider>
  );
};

export const SheetTrigger: React.FC<{
  asChild?: boolean;
  children: React.ReactElement<any>;
}> = ({ children }) => {
  const { onOpenChange } = React.useContext(SheetContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props?.onClick?.(e);
      onOpenChange(true);
    },
  });
};

export const SheetClose: React.FC<{
  asChild?: boolean;
  children: React.ReactElement<any>;
}> = ({ children }) => {
  const { onOpenChange } = React.useContext(SheetContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props?.onClick?.(e);
      onOpenChange(false);
    },
  });
};

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'left' | 'right' | 'top' | 'bottom';
  onClose?: () => void;
}

export const SheetContent: React.FC<SheetContentProps> = ({
  side = 'left',
  className,
  children,
  onClose,
  ...props
}) => {
  const { open, onOpenChange } = React.useContext(SheetContext);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose?.();
        onOpenChange(false);
      }
    };
    if (open) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, onOpenChange]);

  if (!open) return null;

  const sideStyles = {
    left: 'left-0 top-0 bottom-0 w-80 max-w-[85vw] border-r border-zinc-800 animate-in slide-in-from-left duration-200',
    right: 'right-0 top-0 bottom-0 w-80 max-w-[85vw] border-l border-zinc-800 animate-in slide-in-from-right duration-200',
    top: 'top-0 left-0 right-0 max-h-[85vh] border-b border-zinc-800 animate-in slide-in-from-top duration-200',
    bottom: 'bottom-0 left-0 right-0 max-h-[85vh] border-t border-zinc-800 animate-in slide-in-from-bottom duration-200',
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => {
          onClose?.();
          onOpenChange(false);
        }}
      />

      {/* Sheet Content Panel */}
      <div
        className={cn(
          'fixed z-50 bg-[#121212] p-6 shadow-2xl flex flex-col justify-between text-zinc-100',
          sideStyles[side],
          className
        )}
        {...props}
      >
        <button
          type="button"
          onClick={() => {
            onClose?.();
            onOpenChange(false);
          }}
          className="absolute right-4 top-4 rounded-full p-2 text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
};

export const SheetHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('flex flex-col space-y-2 text-left mb-6', className)} {...props} />;

export const SheetTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => <h3 className={cn('text-lg font-bold text-white', className)} {...props} />;

export const SheetDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...props
}) => <p className={cn('text-xs text-zinc-400', className)} {...props} />;

export const SheetFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('flex flex-col gap-2 pt-4 border-t border-zinc-850', className)} {...props} />;
