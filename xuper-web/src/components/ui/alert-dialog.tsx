import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const AlertDialogContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>({
  open: false,
  onOpenChange: () => {},
});

export const AlertDialog: React.FC<AlertDialogProps> = ({
  open = false,
  onOpenChange = () => {},
  children,
}) => {
  return (
    <AlertDialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </AlertDialogContext.Provider>
  );
};

export const AlertDialogTrigger: React.FC<{
  children: React.ReactElement<any>;
}> = ({ children }) => {
  const { onOpenChange } = React.useContext(AlertDialogContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props?.onClick?.(e);
      onOpenChange(true);
    },
  });
};

export const AlertDialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => {
  const { open } = React.useContext(AlertDialogContext);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" />
      <div
        className={cn(
          'relative z-50 w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-white',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
};

export const AlertDialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left mb-4', className)} {...props} />
);

export const AlertDialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6 gap-2', className)}
    {...props}
  />
);

export const AlertDialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => (
  <h2 className={cn('text-lg font-bold text-white', className)} {...props} />
);

export const AlertDialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...props
}) => (
  <p className={cn('text-sm text-zinc-400 leading-relaxed', className)} {...props} />
);

export const AlertDialogAction: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'destructive' }
> = ({ className, onClick, variant = 'default', children, ...props }) => {
  const { onOpenChange } = React.useContext(AlertDialogContext);
  return (
    <Button
      variant={variant === 'destructive' ? 'destructive' : 'default'}
      className={cn('font-semibold', className)}
      onClick={(e) => {
        onClick?.(e);
        onOpenChange(false);
      }}
      {...props}
    >
      {children}
    </Button>
  );
};

export const AlertDialogCancel: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  onClick,
  children,
  ...props
}) => {
  const { onOpenChange } = React.useContext(AlertDialogContext);
  return (
    <Button
      variant="outline"
      className={cn('border-zinc-700 hover:bg-zinc-800 text-zinc-300', className)}
      onClick={(e) => {
        onClick?.(e);
        onOpenChange(false);
      }}
      {...props}
    >
      {children || 'Cancelar'}
    </Button>
  );
};
