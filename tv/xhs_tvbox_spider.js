const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

// ========== 工具函数 ==========

function extractState(html) {
    if (!html || html.indexOf('window.__INITIAL_STATE__') === -1) return null;
    let match = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s);
    if (!match) match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    if (!match) return null;
    let jsonStr = match[1];
    jsonStr = jsonStr.replace(/(?<=[:\[,\s])(undefined)(?=[\s:,\}\]])/g, 'null');
    jsonStr = jsonStr.replace(/NaN/g, 'null');
    try { return JSON.parse(jsonStr); } catch(e) { return null; }
}

// 格式化时间戳
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + 
           String(date.getHours()).padStart(2, '0') + ':' + 
           String(date.getMinutes()).padStart(2, '0');
}

// ========== 数据缓存 ==========
let matchesCache = null;

async function getAllMatches() {
    if (matchesCache) return matchesCache;

    const r = await req(host + '/worldcup26', { headers });
    if (!r || !r.content) return null;

    const state = extractState(r.content);
    if (!state || !state.worldCupMatchSchedule || !state.worldCupMatchSchedule.data) return null;

    const matches = state.worldCupMatchSchedule.data.matches || [];
    matchesCache = matches;
    return matches;
}

// 获取单场比赛数据
async function getMatchById(matchId) {
    const matches = await getAllMatches();
    if (!matches) return null;

    const item = matches.find(m => m.match && m.match.matchId == matchId);
    return item ? item.match : null;
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

async function home(filter) {
    // 四个固定一级菜单
    return JSON.stringify({
        class: [
            { type_id: 'replay', type_name: '全场回放' },
            { type_id: 'highlight', type_name: '全场集锦' },
            { type_id: 'report', type_name: '战报' },
            { type_id: 'high', type_name: '高光时刻' }
        ]
    });
}

async function homeVod() {
    // 首页直接显示所有比赛卡片
    const matches = await getAllMatches();
    if (!matches || matches.length === 0) {
        return JSON.stringify({ list: [] });
    }

    const list = [];

    for (const item of matches) {
        const match = item.match;
        if (!match) continue;

        const matchId = match.matchId || '';
        const homeTeam = match.homeTeamName || '';
        const awayTeam = match.awayTeamName || '';
        const homeScore = match.homeScore ?? '';
        const awayScore = match.awayScore ?? '';
        const status = match.statusDesc || '';
        const round = match.roundStage || '';
        const group = match.groupLabel || '';
        const matchTime = match.matchTime || 0;
        const dateLabel = item.dateLabel || '';

        // 背景图优先级: liveInfo.cover > homeTeamLogo > awayTeamLogo
        let bgPic = '';
        if (match.liveInfo && match.liveInfo.cover) {
            bgPic = match.liveInfo.cover;
        } else if (match.homeTeamLogo) {
            bgPic = match.homeTeamLogo;
        } else if (match.awayTeamLogo) {
            bgPic = match.awayTeamLogo;
        }

        // 构建标题
        let title = homeTeam + ' vs ' + awayTeam;
        if (homeScore !== '' && awayScore !== '') {
            title += ' ' + homeScore + '-' + awayScore;
        }

        // 构建副标题
        let subTitle = round;
        if (group) subTitle += ' ' + group;
        if (dateLabel) subTitle += ' | ' + dateLabel;
        if (status) subTitle += ' | ' + status;

        // 构建内容
        let content = homeTeam;
        if (homeScore !== '') content += ' ' + homeScore;
        content += ' - ';
        if (awayScore !== '') content += awayScore + ' ';
        content += awayTeam + '\n';
        content += '阶段: ' + round + '\n';
        if (group) content += '小组: ' + group + '\n';
        content += '时间: ' + (dateLabel || formatTime(matchTime)) + '\n';
        content += '状态: ' + status;

        list.push({
            vod_id: String(matchId),
            vod_name: title,
            vod_pic: bgPic,
            vod_remarks: subTitle,
            vod_content: content
        });
    }

    return JSON.stringify({ list: list });
}

async function category(tid, pg, filter, extend) {
    // tid 是分类ID: replay, highlight, report, high
    // 返回所有比赛，但每个比赛标记为特定分类
    const matches = await getAllMatches();
    if (!matches || matches.length === 0) {
        return JSON.stringify({ list: [] });
    }

    const list = [];
    const categoryNames = {
        'replay': '全场回放',
        'highlight': '全场集锦',
        'report': '战报',
        'high': '高光时刻'
    };

    for (const item of matches) {
        const match = item.match;
        if (!match) continue;

        const matchId = match.matchId || '';
        const homeTeam = match.homeTeamName || '';
        const awayTeam = match.awayTeamName || '';
        const homeScore = match.homeScore ?? '';
        const awayScore = match.awayScore ?? '';
        const status = match.statusDesc || '';
        const round = match.roundStage || '';

        let bgPic = '';
        if (match.liveInfo && match.liveInfo.cover) {
            bgPic = match.liveInfo.cover;
        } else if (match.homeTeamLogo) {
            bgPic = match.homeTeamLogo;
        } else if (match.awayTeamLogo) {
            bgPic = match.awayTeamLogo;
        }

        let title = homeTeam + ' vs ' + awayTeam;
        if (homeScore !== '' && awayScore !== '') {
            title += ' ' + homeScore + '-' + awayScore;
        }

        // ID编码: matchId#category
        list.push({
            vod_id: String(matchId) + '#' + tid,
            vod_name: title,
            vod_pic: bgPic,
            vod_remarks: (categoryNames[tid] || tid) + ' | ' + status,
            vod_content: '分类: ' + (categoryNames[tid] || tid) + '\n' +
                        homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                        '阶段: ' + round + '\n' +
                        '状态: ' + status
        });
    }

    return JSON.stringify({ list: list });
}

async function detail(id) {
    // 解析ID: matchId#category 或 纯 matchId
    let matchId = id;
    let category = 'replay';

    if (id.indexOf('#') !== -1) {
        const parts = id.split('#');
        matchId = parts[0];
        category = parts[1];
    }

    const categoryNames = {
        'replay': '全场回放',
        'highlight': '全场集锦',
        'report': '战报',
        'high': '高光时刻'
    };

    // 获取比赛数据
    const match = await getMatchById(matchId);
    if (!match) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '比赛未找到: ' + matchId,
                vod_pic: '',
                vod_remarks: '',
                vod_content: 'ID: ' + id,
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const homeTeam = match.homeTeamName || '';
    const awayTeam = match.awayTeamName || '';
    const homeScore = match.homeScore ?? '';
    const awayScore = match.awayScore ?? '';
    const round = match.roundStage || '';
    const status = match.statusDesc || '';
    const group = match.groupLabel || '';
    const dateLabel = match.dateLabel || '';

    // 获取背景图
    let bgPic = '';
    if (match.liveInfo && match.liveInfo.cover) {
        bgPic = match.liveInfo.cover;
    } else if (match.homeTeamLogo) {
        bgPic = match.homeTeamLogo;
    }

    // 构建占位视频项（框架测试，不提取真实视频）
    const videos = [];

    if (category === 'replay') {
        // 全场回放 - 使用 replayNoteId
        if (match.liveInfo && match.liveInfo.replayNoteId) {
            videos.push('官方全场回放$note://' + match.liveInfo.replayNoteId);
        } else {
            videos.push('暂无回放$https://www.baidu.com');
        }
    } else if (category === 'highlight') {
        videos.push('全场集锦(框架测试)$https://www.baidu.com');
    } else if (category === 'report') {
        videos.push('战报视频1(框架测试)$https://www.baidu.com');
        videos.push('战报视频2(框架测试)$https://www.baidu.com');
    } else if (category === 'high') {
        videos.push('高光时刻1(框架测试)$https://www.baidu.com');
        videos.push('高光时刻2(框架测试)$https://www.baidu.com');
        videos.push('高光时刻3(框架测试)$https://www.baidu.com');
    }

    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: homeTeam + ' vs ' + awayTeam + ' [' + (categoryNames[category] || category) + ']',
            vod_pic: bgPic,
            vod_remarks: status,
            vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                        '阶段: ' + round + '\n' +
                        (group ? '小组: ' + group + '\n' : '') +
                        '时间: ' + dateLabel + '\n' +
                        '状态: ' + status + '\n' +
                        '\n[框架测试模式 - 点击播放将提取真实视频]',
            vod_play_from: '小红书',
            vod_play_url: videos.join('#')
        }]
    });
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
    // 如果是笔记ID，返回笔记页面URL
    if (id && id.indexOf('note://') === 0) {
        const noteId = id.replace('note://', '');
        return JSON.stringify({
            parse: 1,
            url: host + '/explore/' + noteId,
            header: {
                'User-Agent': headers['User-Agent'],
                'Referer': 'https://www.xiaohongshu.com/',
                'Origin': 'https://www.xiaohongshu.com'
            }
        });
    }

    // 如果是真实URL，直接播放
    if (id && id.indexOf('http') === 0) {
        return JSON.stringify({
            parse: 0,
            url: id,
            header: {
                'User-Agent': headers['User-Agent'],
                'Referer': 'https://www.xiaohongshu.com/',
                'Origin': 'https://www.xiaohongshu.com'
            }
        });
    }

    return JSON.stringify({
        parse: 0,
        url: id
    });
}

export default { init, home, homeVod, category, detail, search, play };
