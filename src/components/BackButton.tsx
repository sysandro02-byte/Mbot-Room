import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { goBack } from '../lib/navigation';

type BackButtonProps = {
  fallbackPath?: string;
  label?: string;
  className?: string;
};

export default function BackButton({ fallbackPath = '/', label = 'Retour', className = '' }: BackButtonProps) {
  const navigate = useNavigate();
  return (
    <button type="button" className={className} onClick={() => goBack(navigate, fallbackPath)} aria-label={label || 'Retour'}>
      <ArrowLeft size={24} />
      {label && <span>{label}</span>}
    </button>
  );
}
