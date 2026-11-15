import type { ButtonHTMLAttributes } from 'react';
import s from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg';
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: Props) {
  return <button type={type} className={[s.button, s[variant], s[size], className].filter(Boolean).join(' ')} {...rest} />;
}
