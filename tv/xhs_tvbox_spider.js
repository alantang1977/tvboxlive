const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

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

// 从笔记页面提取视频流
async function getNoteVideo(noteId, xsecToken) {
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

        // 优先从 media.stream.h264 提取
        const media = videoData.media || {};
        const stream = media.stream || {};
        const h264 = stream.h264 || [];

        if (h264.length > 0) {
            // 按分辨率排序，取最高清
            h264.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            const best = h264[0];
            return best.masterUrl || (best.backupUrls && best.backupUrls[0]) || null;
        }

        // 尝试 mediaV2
        const mediaV2Str = videoData.mediaV2 || '';
        if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
            try {
                const mediaV2 = JSON.parse(mediaV2Str);
                if (mediaV2 && mediaV2.video && mediaV2.video.stream) {
                    const streamV2 = mediaV2.video.stream;
                    const h264v2 = streamV2.h264 || [];
                    if (h264v2.length > 0) {
                        h264v2.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                        const best = h264v2[0];
                        return best.master_url || (best.backup_urls && best.backup_urls[0]) || null;
                    }
                }
            } catch(e) {}
        }

        return null;
    } catch(e) {
        return null;
    }
}

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: '4459814', type_name: '比赛集锦测试' }
        ]
    });
}

async function homeVod() {
    return JSON.stringify({
        list: [
            {
                vod_id: '4459814',
                vod_name: '4459814 比赛集锦测试',
                vod_pic: '',
                vod_remarks: '点击测试',
                vod_content: '测试提取 highList 视频'
            }
        ]
    });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
    // 只处理 4459814
    if (id !== '4459814') {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '仅支持 4459814',
                vod_pic: '',
                vod_remarks: '',
                vod_content: '请使用 4459814 测试',
                vod_play_from: '测试',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        });
    }

    const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });

        if (!r || !r.content) {
            return JSON.stringify({
                list: [{
                    vod_id: id,
                    vod_name: '请求失败',
                    vod_pic: '',
                    vod_remarks: '错误',
                    vod_content: '无法获取比赛页面',
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
                    vod_content: '无法解析 window.__INITIAL_STATE__',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';

        // 只提取 highList
        const videos = [];
        const highList = matchInfo.highList || [];

        // 调试信息
        let debugInfo = 'highList数量: ' + highList.length + '\n';

        for (let i = 0; i < highList.length; i++) {
            const item = highList[i];
            debugInfo += 'highList[' + i + ']: ' + (item.title || '无标题') + ', type=' + (item.type || 'unknown') + ', noteId=' + (item.noteId || '无') + '\n';

            if (item.noteId && item.type === 'video') {
                // 获取真实视频地址
                const videoUrl = await getNoteVideo(item.noteId, item.xsecToken || '');
                if (videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + videoUrl);
                    debugInfo += '  -> 视频地址获取成功\n';
                } else {
                    // 如果获取失败，使用笔记ID作为占位
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + item.noteId);
                    debugInfo += '  -> 视频地址获取失败，使用笔记ID\n';
                }
            }
        }

        if (videos.length === 0) {
            videos.push('暂无集锦$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: homeTeam + ' vs ' + awayTeam + ' (highList测试)',
                vod_pic: matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: debugInfo,
                vod_play_from: '小红书集锦',
                vod_play_url: videos.join('#')
            }]
        });

    } catch (e) {
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: '异常: ' + e.message,
                vod_pic: '',
                vod_remarks: '错误',
                vod_content: '请求异常: ' + e.toString(),
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
    // 如果是 http 开头的完整URL，直接播放
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

    // 如果是笔记ID，尝试获取真实视频地址
    if (id && id.match(/^[a-f0-9]{24}$/i)) {
        const videoUrl = await getNoteVideo(id, '');
        if (videoUrl) {
            return JSON.stringify({
                parse: 0,
                url: videoUrl,
                header: {
                    'User-Agent': headers['User-Agent'],
                    'Referer': 'https://www.xiaohongshu.com/',
                    'Origin': 'https://www.xiaohongshu.com'
                }
            });
        }
    }

    // 默认返回
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
