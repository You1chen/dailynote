import HelpDialog from './HelpDialog';

/** 首次安装时的图文引导：与导航里的帮助共用同一套翻页内容。 */
export default function FirstRunGuide({ onDismiss }: { onDismiss: () => void }) {
  return <HelpDialog open variant="welcome" onClose={onDismiss} />;
}
