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

// 从笔记页面提取720P视频流
async function getNoteVideo720P(noteId, xsecToken) {
    let noteUrl = host + '/explore/' + noteId;
    if (xsecToken) {
        noteUrl += '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_stab';
    }

    try {
        const r = await req(noteUrl, { headers });
        if (!r || !r.content) return null;

        const state = extractState(r.content);
        if (!state) return null;

        const noteData = state.note?.noteDetailMap?.[noteId]?.note || {};
        const videoData = noteData.video || {};

        let allStreams = [];

        // 1. 从 media.stream 提取
        const media = videoData.media || {};
        const stream = media.stream || {};
        const codecs = ['h264', 'h265', 'av1'];

        for (const codec of codecs) {
            if (stream[codec] && Array.isArray(stream[codec])) {
                for (const s of stream[codec]) {
                    allStreams.push({
                        url: s.masterUrl || (s.backupUrls && s.backupUrls[0]) || '',
                        width: s.width || 0,
                        height: s.height || 0
                    });
                }
            }
        }

        // 2. 从 mediaV2 提取
        const mediaV2Str = videoData.mediaV2 || '';
        if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
            try {
                const mediaV2 = JSON.parse(mediaV2Str);
                if (mediaV2 && mediaV2.video && mediaV2.video.stream) {
                    const streamV2 = mediaV2.video.stream;
                    for (const codec of codecs) {
                        if (streamV2[codec] && Array.isArray(streamV2[codec])) {
                            for (const s of streamV2[codec]) {
                                allStreams.push({
                                    url: s.master_url || (s.backup_urls && s.backup_urls[0]) || '',
                                    width: s.width || 0,
                                    height: s.height || 0
                                });
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 过滤有效URL并去重
        allStreams = allStreams.filter(s => s.url && s.url.indexOf('http') === 0);
        const seen = new Set();
        allStreams = allStreams.filter(s => {
            const base = s.url.split('?')[0];
            if (seen.has(base)) return false;
            seen.add(base);
            return true;
        });

        // 优先720P
        let target720 = allStreams.find(s => s.width === 1280 && s.height === 720);
        if (target720) return target720.url;

        let near720 = allStreams.filter(s => s.height >= 600 && s.height <= 900);
        if (near720.length > 0) {
            near720.sort((a, b) => b.height - a.height);
            return near720[0].url;
        }

        if (allStreams.length > 0) {
            allStreams.sort((a, b) => (a.width * a.height) - (b.width * b.height));
            return allStreams[0].url;
        }

        return null;
    } catch(e) {
        return null;
    }
}

// 智能分类
function getCategory(title) {
    if (!title) return '其他';
    if (title.indexOf('回放') !== -1 || title.indexOf('全场') !== -1) return '全场回放';
    if (title.indexOf('集锦') !== -1 || title.indexOf('高光') !== -1) return '全场集锦';
    return '其他';
}

// ========== 数据缓存 ==========
let cachedMatches = null;
let cacheTime = 0;

async function getMatches() {
    const now = Date.now();
    if (cachedMatches && (now - cacheTime) < 300000) { // 5分钟缓存
        return cachedMatches;
    }

    const r = await req(host + '/worldcup26', { headers });
    if (!r || !r.content) return [];

    const state = extractState(r.content);
    if (!state || !state.worldCupMatch || !state.worldCupMatch.matches) return [];

    cachedMatches = state.worldCupMatch.matches;
    cacheTime = now;
    return cachedMatches;
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

async function home(filter) {
    // 一级菜单固定4项
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
    // 首页显示所有比赛列表（从 /worldcup26 提取）
    const matches = await getMatches();

    const list = matches.map(match => ({
        vod_id: match.matchId || '',
        vod_name: (match.homeTeamName || '') + ' vs ' + (match.awayTeamName || ''),
        vod_pic: match.homeTeamLogo || match.awayTeamLogo || '',
        vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
        vod_content: (match.roundStage || '') + ' ' + (match.matchTime || '') + '\n' + (match.venue || '')
    }));

    return JSON.stringify({ list: list });
}

async function category(tid, pg, filter, extend) {
    // 根据分类筛选比赛视频
    // 先获取所有比赛，然后提取对应分类的视频

    const matches = await getMatches();
    let videos = [];

    for (const match of matches) {
        const matchId = match.matchId;
        const homeTeam = match.homeTeamName || '';
        const awayTeam = match.awayTeamName || '';
        const matchName = homeTeam + ' vs ' + awayTeam;

        // 获取比赛详情（需要请求每个比赛页面）
        // 为了性能，这里简化处理，只从 match 基础数据中提取

        if (tid === 'replay') {
            // 全场回放
            const liveInfo = match.liveInfo || {};
            if (liveInfo.replayNoteId) {
                videos.push({
                    vod_id: matchId + '_replay_' + liveInfo.replayNoteId,
                    vod_name: matchName + ' - 官方回放',
                    vod_pic: match.homeTeamLogo || '',
                    vod_remarks: match.statusDesc || '',
                    vod_content: '官方全场回放'
                });
            }
        }
        // 其他分类需要请求比赛详情页，这里先简化
    }

    // 如果该分类没有数据，显示提示
    if (videos.length === 0) {
        videos.push({
            vod_id: 'empty_' + tid,
            vod_name: '暂无' + tid + '内容',
            vod_pic: '',
            vod_remarks: '',
            vod_content: '该分类下暂无视频，请尝试其他分类'
        });
    }

    return JSON.stringify({ list: videos });
}

async function detail(id) {
    // 解析ID: matchId_category_noteId 或 matchId_category
    const parts = id.split('_');

    if (parts.length < 2) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: 'ID格式错误',
                vod_pic: '',
                vod_remarks: '',
                vod_content: 'ID格式错误: ' + id,
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    // 如果ID包含noteId（从category点击进来）
    if (parts.length >= 3) {
        const matchId = parts[0];
        const category = parts[1];
        const noteId = parts[2];

        // 获取720P视频
        const videoUrl = await getNoteVideo720P(noteId, '');

        if (!videoUrl) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '视频获取失败',
                    vod_pic: '',
                    vod_remarks: '',
                    vod_content: '无法获取720P视频',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const categoryNames = {
            'replay': '全场回放',
            'highlight': '全场集锦',
            'report': '战报',
            'high': '高光时刻'
        };

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: categoryNames[category] || category,
                vod_pic: '',
                vod_remarks: '720P',
                vod_content: '笔记ID: ' + noteId,
                vod_play_from: '小红书',
                vod_play_url: (categoryNames[category] || '视频') + '$' + videoUrl
            }]
        });
    }

    // 如果ID是 matchId（从homeVod点击进来），显示该比赛的所有分类
    const matchId = parts[0];

    // 请求比赛详情
    const matchUrl = host + '/worldcup26/match/' + matchId + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '请求失败',
                    vod_pic: '',
                    vod_remarks: '错误',
                    vod_content: '无法获取比赛详情',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const state = extractState(r.content);
        if (!state) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '解析失败',
                    vod_pic: '',
                    vod_remarks: '错误',
                    vod_content: '无法解析数据',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';

        // 收集所有分类的视频
        const videos = [];

        // 1. 全场回放
        const liveInfo = matchBase.liveInfo || {};
        if (liveInfo.replayNoteId) {
            const videoUrl = await getNoteVideo720P(liveInfo.replayNoteId, liveInfo.xsecToken || '');
            if (videoUrl) {
                videos.push('官方回放$' + videoUrl);
            }
        }

        // 2. 全场集锦（从reportList和highList中筛选）
        const reportList = matchInfo.reportList || [];
        for (let i = 0; i < reportList.length; i++) {
            const item = reportList[i];
            if (item.type === 'video' && getCategory(item.title) === '全场集锦') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                }
            }
        }

        const highList = matchInfo.highList || [];
        for (let i = 0; i < highList.length; i++) {
            const item = highList[i];
            if (item.type === 'video' && getCategory(item.title) === '全场集锦') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                }
            }
        }

        // 3. 战报
        for (let i = 0; i < reportList.length; i++) {
            const item = reportList[i];
            if (item.type === 'video' && getCategory(item.title) !== '全场集锦') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '战报' + (i + 1)) + '$' + videoUrl);
                }
            }
        }

        // 4. 高光时刻
        for (let i = 0; i < highList.length; i++) {
            const item = highList[i];
            if (item.type === 'video' && getCategory(item.title) !== '全场集锦') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '高光' + (i + 1)) + '$' + videoUrl);
                }
            }
        }

        if (videos.length === 0) {
            videos.push('暂无视频$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: matchId,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + (matchBase.homeScore || '0') + ' - ' + (matchBase.awayScore || '0') + ' ' + awayTeam,
                vod_play_from: '小红书',
                vod_play_url: videos.join('#')
            }]
        });

    } catch (e) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '异常',
                vod_pic: '',
                vod_remarks: '错误',
                vod_content: e.toString(),
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }
}

async function search(wd, quick, pg) {
    return JSON.stringify({ page: pg, list: [] });
}

async function play(flag, id, flags) {
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

export default { init, home, homeVod, category, detail, search, play };
