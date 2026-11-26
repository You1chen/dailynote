import {
  BookOpen,
  CalendarDays,
  Hand,
  Layers,
  ListTodo,
  Network,
  Camera,
  Settings2,
  Sparkles,
} from 'lucide-react';
import Sheet from './Sheet';
import { useUi } from '../state/ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    icon: CalendarDays,
    title: '日程：框选一段时间',
    steps: [
      '轻点时间轴的空白处，按默认时长新建；长按后再上下拖动，可以框出任意起止时间。',
      '松手后会打开编辑面板，时间已经填好，写一个名字就能保存。',
      '点已有的日程块可以修改时间、内容和完成状态；完成后的块会淡化显示。',
      '点大日期打开月历选日，左右箭头切前一天/后一天；不在今天时会出现「今天」。',
    ],
  },
  {
    icon: ListTodo,
    title: '待办：收在顶部抽屉里',
    steps: [
      '点顶部右侧的「待办」按钮，打开全屏清单。',
      '在顶部输入框写下事情，回车即可添加；点一下条目完成，4 秒内可以撤销。',
      '「整理层级」里可以用左右箭头调整缩进，＋ 添加子项，完成后统一保存。',
      '曾经搁置的条目收在「遗留」里，随时可以移回清单。',
    ],
  },
  {
    icon: Layers,
    title: '卡片：留下想留下的',
    steps: [
      '在「卡片」页点右上角新建，写标题、正文、贴图片，也可以加标签和课程。',
      '卡片支持知识、顿悟、鉴赏、疑问等类型，类型只影响标识和颜色，不限制内容。',
      '点卡片可以查看大图、正文和它已确认关联的其他卡片。',
      '旧版本里的录音和评论仍然保留，会随卡片一起显示。',
    ],
  },
  {
    icon: Network,
    title: '关系网：看见卡片之间的联系',
    steps: [
      '在「卡片 → 关系网」里，拖动画布可以平移，滚轮或双指可以缩放，点节点查看卡片。',
      '长按节点会弹出菜单：可以给卡片设置关键词，也可以只看这张卡片的关联建议。',
      '实线是已确认的关联（手动挑选、相同关键词或标签）；虚线是系统发现但还没确认的建议。',
      '点「关联建议」逐条接受或忽略；接受后才会写入卡片关联，可撤销，忽略的建议也能恢复。',
      '顶部可以按时间范围和关键词筛选，只看最近的一批卡片；菜单底部预留了功能扩展位。',
    ],
  },
  {
    icon: Camera,
    title: '相机球：拍照',
    steps: [
      '右下角的相机球随时可用。拍下课程表、板书或书页，也可以从相册选图。',
      '拍完先选：识别成日程，或保存为卡片。',
      '选择保存为卡片时，可以关闭「识别文字」，只保留图片；之后在卡片编辑器里补备注。',
      '识别在本机完成，图片不会上传；网页版第一次会加载中文模型，之后可以离线识别。',
    ],
  },
  {
    icon: BookOpen,
    title: '课程表：从课程网站导入',
    steps: [
      '在「今日」页的课程区点「导入课表」，可以输入课程网站地址、粘贴网页源码/表格文本，或直接拍截图识别。',
      '网页版受浏览器跨域限制，多数教务系统需要登录，建议用 Android App 的站内打开和抓取，或复制网页源码粘贴。',
      '解析后先预览：可以逐行修改课程名、星期、时间、地点和周次，再确认开学日期。',
      '导入默认替换旧课程；如果只是补充几门课，关掉「替换现有课程」即可。',
    ],
  },
  {
    icon: Settings2,
    title: '设置与数据',
    steps: [
      '右上角齿轮里可以切换浅色/深色/跟随系统，修改默认日程时长。',
      '「数据与备份」可以立即保存、导出备份、导入备份或重新扫描存储目录。',
      '所有数据默认留在本机：Android 在 Documents/DailyNote，网页在浏览器 IndexedDB。',
      '换设备时导出备份，再在新设备导入即可。',
    ],
  },
  {
    icon: Hand,
    title: '几个小习惯',
    steps: [
      '底部两个标签就是全部主页面：今日和卡片。',
      '浮层从上往下拖、点遮罩或按 Esc / Android 返回键都能关闭。',
      '时间轴自动定位到当前时刻；想快速记下一件事，直接点时间轴的空白处。',
      '所有保存动作都有轻提示，重要的删除会再确认一次。',
    ],
  },
];

export default function HelpSheet({ open, onClose }: Props) {
  const ui = useUi();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="使用说明"
      subtitle="两页应用，四件核心事：日程、待办、卡片、关系网"
      size="full"
      footer={(
        <>
          <span className="v-tiny v-grow">数据全部保存在本机</span>
          <button type="button" className="v-btn v-btn--ghost" onClick={() => { onClose(); ui.openSettings(); }}>
            打开设置
          </button>
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>知道了</button>
        </>
      )}
    >
      <div className="v-manual-hero">
        <p className="v-page-eyebrow" style={{ marginBottom: 8 }}>DailyNote · 使用说明</p>
        <h2>少一点入口，多一点完成。</h2>
        <p>
          这一版把内容收进两页：<strong>今日</strong>处理时间与待办，<strong>卡片</strong>收藏想法和它们之间的关系。
          相机球负责把纸面内容带进来，说明书就是这一页。
        </p>
        <div className="v-row" style={{ marginTop: 14, gap: 6, flexWrap: 'wrap' }}>
          <span className="v-chip v-chip--soft"><Sparkles size={12} /> 框选建日程</span>
          <span className="v-chip v-chip--soft">顶部看待办</span>
          <span className="v-chip v-chip--soft">相机转文字</span>
          <span className="v-chip v-chip--soft">卡片关系网</span>
        </div>
      </div>

      {SECTIONS.map(({ icon: Icon, title, steps }) => (
        <section className="v-manual-section" key={title}>
          <div className="v-manual-icon"><Icon size={19} /></div>
          <div>
            <h3>{title}</h3>
            <ol>
              {steps.map(step => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </section>
      ))}
    </Sheet>
  );
}
