import * as React from 'react';
import { cn } from '@/lib/utils';

interface DropdownContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownContext = React.createContext<DropdownContextType>({
  open: false,
  setOpen: () => {},
});

export const DropdownMenu: React.FC<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}> = ({ open: controlledOpen, onOpenChange, children }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (onOpenChange) onOpenChange(newOpen);
      else setInternalOpen(newOpen);
    },
    [onOpenChange]
  );

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  );
};

export const DropdownMenuTrigger: React.FC<{
  asChild?: boolean;
  children: React.ReactElement<any>;
}> = ({ children }) => {
  const { open, setOpen } = React.useContext(DropdownContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props?.onClick?.(e);
      setOpen(!open);
    },
    'aria-expanded': open,
  });
};

export const DropdownMenuContent: React.FC<React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'end' | 'center' }> = ({
  className,
  align = 'start',
  children,
  ...props
}) => {
  const { open, setOpen } = React.useContext(DropdownContext);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [open, setOpen]);

  if (!open) return null;

  const alignStyles = {
    start: 'left-0 origin-top-left',
    end: 'right-0 origin-top-right',
    center: 'left-1/2 -translate-x-1/2 origin-top',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 mt-2 min-w-[200px] overflow-hidden rounded-xl border border-zinc-800 bg-[#161616]/95 backdrop-blur-md p-1.5 text-zinc-100 shadow-2xl animate-in fade-in-0 zoom-in-95',
        alignStyles[align],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const DropdownMenuItem: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { inset?: boolean }
> = ({ className, inset, children, onClick, ...props }) => {
  const { setOpen } = React.useContext(DropdownContext);
  return (
    <button
      type="button"
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold outline-none transition-colors hover:bg-zinc-800/80 hover:text-white focus:bg-zinc-800 focus:text-white text-zinc-300',
        inset && 'pl-8',
        className
      )}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </button>
  );
};

export const DropdownMenuSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => <div className={cn('-mx-1 my-1 h-px bg-zinc-800', className)} {...props} />;
