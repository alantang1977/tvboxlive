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

// 智能分类标题
function getCategory(title) {
    if (!title) return '其他';
    if (title.indexOf('回放') !== -1 || title.indexOf('全场') !== -1) return '全场回放';
    if (title.indexOf('集锦') !== -1 || title.indexOf('高光') !== -1) return '全场集锦';
    return '其他';
}

// ========== TVBOX 接口 ==========

async function init(cfg) {}

async function home(filter) {
    // 四个固定分类
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
    // 返回 4459814 作为入口
    return JSON.stringify({
        list: [
            {
                vod_id: '4459814',
                vod_name: '世界杯 4459814',
                vod_pic: 'https://via.placeholder.com/300x400?text=World+Cup+4459814',
                vod_remarks: '选择分类查看',
                vod_content: '支持：全场回放、全场集锦、战报、高光时刻'
            }
        ]
    });
}

async function category(tid, pg, filter, extend) {
    // tid 是分类ID: replay, highlight, report, high
    // 返回该分类下的视频列表

    const matchUrl = host + '/worldcup26/match/4459814?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });
        if (!r || !r.content) {
            return JSON.stringify({ list: [] });
        }

        const state = extractState(r.content);
        if (!state) {
            return JSON.stringify({ list: [] });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        let videos = [];

        if (tid === 'replay') {
            // 全场回放 - 从 liveInfo.replayNoteId
            const liveInfo = matchBase.liveInfo || {};
            if (liveInfo.replayNoteId) {
                videos.push({
                    vod_id: '4459814_replay_' + liveInfo.replayNoteId,
                    vod_name: '官方全场回放',
                    vod_pic: matchBase.homeTeamLogo || '',
                    vod_remarks: '官方回放',
                    vod_content: '全场回放视频'
                });
            }
        } else if (tid === 'highlight') {
            // 全场集锦 - 从 reportList 和 highList 中筛选标题含"集锦"的
            const allItems = [];

            const reportList = matchInfo.reportList || [];
            for (const item of reportList) {
                if (item.type === 'video' && getCategory(item.title || '') === '全场集锦') {
                    allItems.push(item);
                }
            }

            const highList = matchInfo.highList || [];
            for (const item of highList) {
                if (item.type === 'video' && getCategory(item.title || '') === '全场集锦') {
                    allItems.push(item);
                }
            }

            for (let i = 0; i < allItems.length; i++) {
                const item = allItems[i];
                videos.push({
                    vod_id: '4459814_highlight_' + item.noteId,
                    vod_name: item.title || '集锦' + (i + 1),
                    vod_pic: item.cover || '',
                    vod_remarks: (item.nickname || '') + ' | ' + (item.likes || 0) + '赞',
                    vod_content: item.title || ''
                });
            }
        } else if (tid === 'report') {
            // 战报 - reportList 中所有 video 类型
            const reportList = matchInfo.reportList || [];
            for (let i = 0; i < reportList.length; i++) {
                const item = reportList[i];
                if (item.type === 'video') {
                    videos.push({
                        vod_id: '4459814_report_' + item.noteId,
                        vod_name: item.title || '战报' + (i + 1),
                        vod_pic: item.cover || '',
                        vod_remarks: (item.nickname || '') + ' | ' + (item.likes || 0) + '赞',
                        vod_content: item.title || ''
                    });
                }
            }
        } else if (tid === 'high') {
            // 高光时刻 - highList 中所有 video 类型
            const highList = matchInfo.highList || [];
            for (let i = 0; i < highList.length; i++) {
                const item = highList[i];
                if (item.type === 'video') {
                    videos.push({
                        vod_id: '4459814_high_' + item.noteId,
                        vod_name: item.title || '高光' + (i + 1),
                        vod_pic: item.cover || '',
                        vod_remarks: (item.nickname || '') + ' | ' + (item.likes || 0) + '赞',
                        vod_content: item.title || ''
                    });
                }
            }
        }

        if (videos.length === 0) {
            videos.push({
                vod_id: '4459814_empty_' + tid,
                vod_name: '暂无' + tid + '内容',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '该分类下暂无视频'
            });
        }

        return JSON.stringify({ list: videos });

    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

async function detail(id) {
    // 解析ID格式: 4459814_{category}_{noteId}
    const parts = id.split('_');
    if (parts.length < 3 || parts[0] !== '4459814') {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: 'ID格式错误',
                vod_pic: '',
                vod_remarks: '',
                vod_content: 'ID格式应为: 4459814_category_noteId',
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const category = parts[1];
    const noteId = parts[2];

    // 获取720P视频地址
    const videoUrl = await getNoteVideo720P(noteId, '');

    if (!videoUrl) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '视频获取失败',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '无法获取720P视频地址',
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
            vod_content: '分类: ' + (categoryNames[category] || category) + '\n笔记ID: ' + noteId,
            vod_play_from: '小红书',
            vod_play_url: (categoryNames[category] || '视频') + '$' + videoUrl
        }]
    });
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
