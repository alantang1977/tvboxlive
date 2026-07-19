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

// 从笔记页面提取封面图
async function getNoteCover(noteId, xsecToken) {
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

        // 1. 优先从 imageList 提取
        const imageList = noteData.imageList || [];
        if (imageList.length > 0) {
            const firstImage = imageList[0];
            // 尝试多个字段
            const url = firstImage.urlDefault || firstImage.url || firstImage.urlPre || null;
            if (url) return url;
        }

        // 2. 从 video 的 consumer 提取封面
        const video = noteData.video || {};
        const consumer = video.consumer || {};
        if (consumer.originVideoKey) {
            // 视频封面通常是视频的第一帧，尝试从视频数据中提取
            const videoPoster = video.cover || video.poster || null;
            if (videoPoster) {
                if (typeof videoPoster === 'string') return videoPoster;
                if (videoPoster.urlDefault) return videoPoster.urlDefault;
                if (videoPoster.url) return videoPoster.url;
            }
        }

        // 3. 从 note 的 cover 字段提取
        const cover = noteData.cover || {};
        if (cover.urlDefault) return cover.urlDefault;
        if (cover.url) return cover.url;

        return null;
    } catch(e) {
        return null;
    }
}

// 只提取720P视频流
async function getNoteVideo720p(noteId, xsecToken) {
    let noteUrl = host + '/explore/' + noteId;
    if (xsecToken) {
        noteUrl += '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_stab';
    }

    try {
        const r = await req(noteUrl, { headers });
        if (!r || !r.content) return { videoUrl: null, coverUrl: null };

        const state = extractState(r.content);
        if (!state) return { videoUrl: null, coverUrl: null };

        const noteData = state.note?.noteDetailMap?.[noteId]?.note || {};
        const videoData = noteData.video || {};

        // 提取封面图
        let coverUrl = null;
        const imageList = noteData.imageList || [];
        if (imageList.length > 0) {
            coverUrl = imageList[0].urlDefault || imageList[0].url || null;
        }
        if (!coverUrl) {
            const cover = noteData.cover || {};
            coverUrl = cover.urlDefault || cover.url || null;
        }
        if (!coverUrl && videoData.cover) {
            const vc = videoData.cover;
            coverUrl = vc.urlDefault || vc.url || null;
        }

        // 提取720P视频
        const media = videoData.media || {};
        const stream = media.stream || {};
        const h264 = stream.h264 || [];

        let target720 = null;
        let minDiff = Infinity;
        const targetPixels = 1280 * 720;

        for (const s of h264) {
            const w = s.width || 0;
            const h = s.height || 0;
            const pixels = w * h;
            const diff = Math.abs(pixels - targetPixels);
            if (diff < minDiff) {
                minDiff = diff;
                target720 = s;
            }
        }

        let videoUrl = null;
        if (target720) {
            videoUrl = target720.masterUrl || (target720.backupUrls && target720.backupUrls[0]) || null;
        } else if (h264.length > 0) {
            videoUrl = h264[0].masterUrl || (h264[0].backupUrls && h264[0].backupUrls[0]) || null;
        }

        // 尝试 mediaV2
        if (!videoUrl) {
            const mediaV2Str = videoData.mediaV2 || '';
            if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
                try {
                    const mediaV2 = JSON.parse(mediaV2Str);
                    if (mediaV2 && mediaV2.video && mediaV2.video.stream) {
                        const h264v2 = mediaV2.video.stream.h264 || [];
                        if (h264v2.length > 0) {
                            videoUrl = h264v2[0].master_url || (h264v2[0].backup_urls && h264v2[0].backup_urls[0]) || null;
                        }
                    }
                } catch(e) {}
            }
        }

        return { videoUrl, coverUrl };
    } catch(e) {
        return { videoUrl: null, coverUrl: null };
    }
}

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: '4459814', type_name: '比赛集锦' }
        ]
    });
}

async function homeVod() {
    try {
        const url = host + '/worldcup26';
        const r = await req(url, { headers });

        if (r && r.content) {
            const state = extractState(r.content);
            if (state && state.worldCupMatch && state.worldCupMatch.matches) {
                const matches = state.worldCupMatch.matches;
                const targetMatch = matches.find(m => m.matchId === '4459814');

                if (targetMatch) {
                    // 使用占位图片，因为 matchBase 可能没有直接可用的封面图
                    return JSON.stringify({
                        list: [
                            {
                                vod_id: targetMatch.matchId || '4459814',
                                vod_name: (targetMatch.homeTeamName || '') + ' vs ' + (targetMatch.awayTeamName || ''),
                                vod_pic: 'https://via.placeholder.com/300x400?text=' + encodeURIComponent((targetMatch.homeTeamName || '') + '+' + (targetMatch.awayTeamName || '')),
                                vod_remarks: (targetMatch.statusDesc || '') + ' | ' + (targetMatch.homeScore || '0') + '-' + (targetMatch.awayScore || '0'),
                                vod_content: (targetMatch.roundStage || '') + ' ' + (targetMatch.matchTime || '')
                            }
                        ]
                    });
                }
            }
        }
    } catch(e) {}

    return JSON.stringify({
        list: [
            {
                vod_id: '4459814',
                vod_name: '4459814 比赛集锦',
                vod_pic: 'https://via.placeholder.com/300x400?text=4459814',
                vod_remarks: '点击观看集锦',
                vod_content: '世界杯比赛集锦'
            }
        ]
    });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
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
                    vod_content: '无法解析页面数据',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知';
        const awayTeam = matchBase.awayTeamName || '未知';
        const homeScore = matchBase.homeScore || '0';
        const awayScore = matchBase.awayScore || '0';

        // 只提取 highList，最多3个
        const videos = [];
        const highList = matchInfo.highList || [];
        const maxItems = Math.min(highList.length, 3);

        // 用于封面的图片（取第一个视频的封面）
        let detailCover = '';

        for (let i = 0; i < maxItems; i++) {
            const item = highList[i];
            if (item.noteId && item.type === 'video') {
                const result = await getNoteVideo720p(item.noteId, item.xsecToken || '');
                if (result.videoUrl) {
                    videos.push((item.title || '集锦' + (i + 1)) + '$' + result.videoUrl);
                    // 使用第一个成功获取的视频封面作为详情页封面
                    if (!detailCover && result.coverUrl) {
                        detailCover = result.coverUrl;
                    }
                }
            }
        }

        if (videos.length === 0) {
            videos.push('暂无集锦$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: detailCover || 'https://via.placeholder.com/300x400?text=' + encodeURIComponent(homeTeam + '+' + awayTeam),
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam,
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
                vod_content: '请求异常',
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
