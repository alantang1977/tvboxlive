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
                        height: s.height || 0,
                        source: 'media.' + codec
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
                                    height: s.height || 0,
                                    source: 'mediaV2.' + codec
                                });
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 过滤有效URL
        allStreams = allStreams.filter(s => s.url && s.url.indexOf('http') === 0);

        // 去重
        const seen = new Set();
        allStreams = allStreams.filter(s => {
            const base = s.url.split('?')[0];
            if (seen.has(base)) return false;
            seen.add(base);
            return true;
        });

        // 优先选择720P (1280x720)
        let target720 = allStreams.find(s => s.width === 1280 && s.height === 720);
        if (target720) return target720.url;

        // 找接近720P的 (高度 600-900)
        let near720 = allStreams.filter(s => s.height >= 600 && s.height <= 900);
        if (near720.length > 0) {
            near720.sort((a, b) => b.height - a.height);
            return near720[0].url;
        }

        // 返回最低清晰度
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
function getVideoCategory(title) {
    if (!title) return 'other';
    if (title.indexOf('回放') !== -1 || title.indexOf('全场') !== -1) return 'replay';
    if (title.indexOf('集锦') !== -1 || title.indexOf('高光') !== -1) return 'highlight';
    return 'other';
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

async function home(filter) {
    // 一级菜单：全场回放$$$全场集锦$$$战报$$$高光时刻
    // 使用 $$$ 分隔多个播放源（TVBOX标准格式）
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
    // 首页直接显示所有比赛列表
    // 从 /worldcup26 提取 match cards
    try {
        const r = await req(host + '/worldcup26', { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state || !state.worldCupMatch || !state.worldCupMatch.matches) {
            return JSON.stringify({ list: [] });
        }

        const matches = state.worldCupMatch.matches;
        const list = [];

        for (const match of matches) {
            // 构建背景图 - 使用 matchBase 中的背景图或球队logo组合
            let bgPic = match.backgroundImage || '';
            if (!bgPic && match.homeTeamLogo && match.awayTeamLogo) {
                // 如果没有背景图，使用主队logo作为封面
                bgPic = match.homeTeamLogo;
            }

            list.push({
                vod_id: match.matchId || '',
                vod_name: (match.homeTeamName || '主队') + ' vs ' + (match.awayTeamName || '客队'),
                vod_pic: bgPic,
                vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
                vod_content: '阶段: ' + (match.roundStage || '') + '\n' +
                            '时间: ' + (match.matchTime || '') + '\n' +
                            '场地: ' + (match.venue || '')
            });
        }

        return JSON.stringify({ list: list });

    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function category(tid, pg, filter, extend) {
    // tid 是分类ID，但这里我们返回所有比赛列表
    // 用户点击比赛后，在 detail 中根据分类筛选视频
    return homeVod();
}

async function detail(id) {
    // id 是 matchId，如 4459814
    // 需要提取该比赛的所有分类视频，用 $$$ 分隔不同分类

    const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '请求失败',
                    vod_pic: '',
                    vod_remarks: '',
                    vod_content: '无法获取比赛页面',
                    vod_play_from: '全场回放$$$全场集锦$$$战报$$$高光时刻',
                    vod_play_url: '暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com'
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
                    vod_remarks: '',
                    vod_content: '无法解析页面数据',
                    vod_play_from: '全场回放$$$全场集锦$$$战报$$$高光时刻',
                    vod_play_url: '暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';

        // 收集四个分类的视频
        const replayVideos = [];
        const highlightVideos = [];
        const reportVideos = [];
        const highVideos = [];

        // 1. 全场回放 - liveInfo.replayNoteId
        const liveInfo = matchBase.liveInfo || {};
        if (liveInfo.replayNoteId) {
            const videoUrl = await getNoteVideo720P(liveInfo.replayNoteId, liveInfo.xsecToken || '');
            if (videoUrl) {
                replayVideos.push('官方全场回放$' + videoUrl);
            }
        }

        // 2. 全场集锦 + 战报 - reportList
        const reportList = matchInfo.reportList || [];
        for (let i = 0; i < reportList.length; i++) {
            const item = reportList[i];
            if (item.noteId && item.type === 'video') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    const cat = getVideoCategory(item.title || '');
                    if (cat === 'replay') {
                        replayVideos.push((item.title || '回放' + (i + 1)) + '$' + videoUrl);
                    } else if (cat === 'highlight') {
                        highlightVideos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                    } else {
                        reportVideos.push((item.title || '战报' + (i + 1)) + '$' + videoUrl);
                    }
                }
            }
        }

        // 3. 高光时刻 - highList
        const highList = matchInfo.highList || [];
        for (let i = 0; i < highList.length; i++) {
            const item = highList[i];
            if (item.noteId && item.type === 'video') {
                const videoUrl = await getNoteVideo720P(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    highVideos.push((item.title || '高光' + (i + 1)) + '$' + videoUrl);
                }
            }
        }

        // 如果某个分类为空，添加占位
        if (replayVideos.length === 0) replayVideos.push('暂无全场回放$https://www.baidu.com');
        if (highlightVideos.length === 0) highlightVideos.push('暂无全场集锦$https://www.baidu.com');
        if (reportVideos.length === 0) reportVideos.push('暂无战报$https://www.baidu.com');
        if (highVideos.length === 0) highVideos.push('暂无高光时刻$https://www.baidu.com');

        // 使用 $$$ 分隔不同分类（TVBOX标准格式）
        // vod_play_from: '全场回放$$$全场集锦$$$战报$$$高光时刻'
        // vod_play_url: '视频1$url1#视频2$url2$$$视频3$url3#视频4$url4$$$...'
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: matchBase.backgroundImage || matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + (matchBase.homeScore || '0') + ' - ' + (matchBase.awayScore || '0') + ' ' + awayTeam + '\n' +
                            '比赛时间: ' + (matchBase.matchTime || '') + '\n' +
                            '场地: ' + (matchBase.venue || '') + '\n' +
                            '阶段: ' + (matchBase.roundStage || ''),
                vod_play_from: '全场回放$$$全场集锦$$$战报$$$高光时刻',
                vod_play_url: replayVideos.join('#') + '$$$' + highlightVideos.join('#') + '$$$' + reportVideos.join('#') + '$$$' + highVideos.join('#')
            }]
        });

    } catch (e) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '异常: ' + e.message,
                vod_pic: '',
                vod_remarks: '',
                vod_content: e.toString(),
                vod_play_from: '全场回放$$$全场集锦$$$战报$$$高光时刻',
                vod_play_url: '暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com#暂无视频$https://www.baidu.com'
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
