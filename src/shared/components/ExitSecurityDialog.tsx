import './ExitSecurityDialog.css';

type Props = {
  open: boolean;
  reason: 'logout' | 'back';
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ExitSecurityDialog({open,reason,onCancel,onConfirm}:Props){
  if(!open)return null;
  return (
    <div className="exit-security-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onCancel()}>
      <section className="exit-security-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-security-title">
        <div className="exit-security-icon" aria-hidden="true">↪</div>
        <div className="exit-security-kicker">SESSION CONFIRMATION</div>
        <h2 id="exit-security-title">{reason==='back'?'Leave the Field Suite?':'Sign out?'}</h2>
        <p>{reason==='back'
          ? 'The browser Back button would leave your active workspace. Stay in the suite or sign out safely.'
          : 'Are you sure you want to end this session?'}</p>
        <div className="exit-security-actions">
          <button type="button" className="stay" onClick={onCancel}>Stay in the suite</button>
          <button type="button" className="leave" onClick={onConfirm}>Sign out</button>
        </div>
      </section>
    </div>
  );
}
