// data.js — 默认数据：正念语句库、场景分类、形象卡字段、提示词模板
'use strict';

var MIND_MOMENTS = {
  morning: '起床后 · 感恩晨启',
  water: '喝水时 · 水的感受',
  meal: '吃饭时 · 慢食感恩',
  action: '行动前 · 心理建设',
  sleep: '睡前 · 感恩与回看'
};

var DEFAULT_MIND = [
  { moment: 'morning', text: '感谢我又拥有完整的一天。今天，我离理想中的自己更近一步。' },
  { moment: 'morning', text: '今天不是昨天的重复，是通往未来我的一天。' },
  { moment: 'morning', text: '我是自己人生的导演，今天的剧本由我写下。' },
  { moment: 'morning', text: '人生是一场体验。今天，我要快乐地、积极地完成这场体验。' },
  { moment: 'water', text: '感受水经过喉咙的清凉——每一个细胞都在苏醒，我的身体值得被温柔对待。' },
  { moment: 'water', text: '这一口水，是生命给我的能量。感谢水的滋养。' },
  { moment: 'water', text: '水是流动的，我也是。像水一样柔软，也像水一样坚定。' },
  { moment: 'meal', text: '感恩这餐饭背后的阳光、土地、雨水和无数双手。我细细品尝，不匆忙。' },
  { moment: 'meal', text: '慢慢吃。食物进入身体，成为我走向未来自己的力量。' },
  { moment: 'action', text: '深呼吸三次。我准备好了。害怕和犹豫是正常的，但我要去行动，让一切发生。' },
  { moment: 'action', text: '未来的我，会为此刻的决定而感谢现在的我。去做。' },
  { moment: 'action', text: '不追求完美，只追求完成。完成就是进步。' },
  { moment: 'sleep', text: '今天值得感恩的三件事……我记下了。明天，我要靠近的愿望是……' },
  { moment: 'sleep', text: '放下今天的一切评判，我带着平静入睡。明天继续朝愿景前进。' },
  { moment: 'sleep', text: '感谢今天遇到的每一个人、每一件事。它们都是来帮我完成人生的体验。' }
];

var SCENE_CATEGORIES = [
  { key: 'home', label: '我的家' },
  { key: 'hobby', label: '爱好角落' },
  { key: 'parents', label: '父母的晚年' },
  { key: 'child', label: '我的孩子' },
  { key: 'work', label: '我的工作' },
  { key: 'travel', label: '我的旅行' }
];

var WISH_TYPES = [
  { key: 'short', label: '短期 · 本周' },
  { key: 'mid', label: '中期 · 本季' },
  { key: 'long', label: '长期 · 人生' }
];

// 形象卡字段
var PROFILE_FIELDS = [
  { key: 'hair', label: '发型', placeholder: '如：利落齐肩短发 / 微卷长发' },
  { key: 'manner', label: '神态关键词', placeholder: '如：端庄、从容、温和、坚定' },
  { key: 'temperament', label: '气质风格', placeholder: '如：知性 / 松弛 / 优雅 / 锐利' },
  { key: 'ageFeel', label: '年龄感', placeholder: '如：保持现在的年轻状态（⚠️不要写"五年后/老了"这类词，AI 会真的让你变老）' },
  { key: 'outfit', label: '常驻着装', placeholder: '如：米色亚麻衬衫，简约耳饰' },
  { key: 'accessory', label: '标志性配饰', placeholder: '如：一条细金链，一本随身手帐' }
];

// 生成提示词（供外部 AI 生图使用）
// ratio: 像你的百分比（0-100），用于榜样融合
function buildIdentityPrompt(profile, sceneText, ratio) {
  var person = [profile.hair, profile.manner, profile.temperament, profile.outfit, profile.ageFeel, profile.accessory]
    .filter(Boolean).join('，');
  var lines = [
    '[人物] ' + (person || '（请先填写形象卡）'),
    '[面容] 青春洋溢的年轻面容，肤质光滑细腻零皱纹，苹果肌饱满，眼神明亮清澈，笑容灿烂阳光，看起来充满活力、比实际年龄更年轻',
    '[神态] 神情端庄自然，与真实照片中的神韵一致，从容自信',
    '[场景] ' + (sceneText || '干净明亮的空间，阳光明媚'),
    '[摄影] 35mm 人像镜头，柔和的自然光，年轻光洁的肤质，杂志画报质感，高清'
  ];
  if (ratio != null && ratio >= 0 && ratio <= 100) {
    lines.push('[参考] 以上传的真实照片为脸型与神韵基础（像你 ' + ratio + '%），参考榜样图的' +
      '神态气质（像榜样 ' + (100 - ratio) + '%），保持脸部轮廓是你、神情有榜样的风骨');
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_MIND: DEFAULT_MIND, MIND_MOMENTS: MIND_MOMENTS, SCENE_CATEGORIES: SCENE_CATEGORIES, WISH_TYPES: WISH_TYPES, PROFILE_FIELDS: PROFILE_FIELDS, buildIdentityPrompt: buildIdentityPrompt };
}
