import './AppLoader.css';

type AppLoaderProps = {
  label?: string;
  fullScreen?: boolean;
  compact?: boolean;
  overlay?: boolean;
};

export default function AppLoader({
  label = 'Chargement…',
  fullScreen = false,
  compact = false,
  overlay = false,
}: AppLoaderProps) {
  const className = [
    'app-loader',
    fullScreen ? 'app-loader--fullscreen' : '',
    compact ? 'app-loader--compact' : '',
    overlay ? 'app-loader--overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} role="status" aria-live="polite" aria-label={label || 'Chargement'}>
      <span className="app-loader__spinner" aria-hidden="true">
        <i className="app-loader__arc app-loader__arc--teal" />
        <i className="app-loader__arc app-loader__arc--navy" />
      </span>
      <span className="app-loader__sr">{label || 'Chargement'}</span>
    </div>
  );
}
