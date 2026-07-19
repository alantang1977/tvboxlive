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

async function init(cfg) {}

async function home(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'all', type_name: '全部比赛' }
        ]
    });
}

async function homeVod() {
    // 直接返回 4459814 的测试数据
    return JSON.stringify({
        list: [
            {
                vod_id: '4459814',
                vod_name: '测试比赛 4459814',
                vod_pic: 'https://via.placeholder.com/300x400?text=4459814',
                vod_remarks: '测试中',
                vod_content: '测试比赛内容'
            }
        ]
    });
}

async function category(tid, pg, filter, extend) {
    return homeVod();
}

async function detail(id) {
    // 测试 4459814
    const matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';

    try {
        const r = await req(matchUrl, { headers });

        if (!r || !r.content) {
            return JSON.stringify({ 
                list: [{
                    vod_id: id,
                    vod_name: '请求失败 - 无内容',
                    vod_pic: '',
                    vod_remarks: '错误',
                    vod_content: '无法获取页面内容',
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const state = extractState(r.content);

        if (!state) {
            // 返回原始内容前200字符用于调试
            const preview = r.content.substring(0, 500);
            return JSON.stringify({ 
                list: [{
                    vod_id: id,
                    vod_name: '解析失败',
                    vod_pic: '',
                    vod_remarks: '错误',
                    vod_content: '无法解析 window.__INITIAL_STATE__\n页面预览: ' + preview,
                    vod_play_from: '测试',
                    vod_play_url: '测试$https://www.baidu.com'
                }]
            });
        }

        const matchBase = state.worldCupMatch?.matchBase || {};
        const matchInfo = state.worldCupMatch?.matchInfo || {};

        const homeTeam = matchBase.homeTeamName || '未知主队';
        const awayTeam = matchBase.awayTeamName || '未知客队';
        const homeScore = matchBase.homeScore || '0';
        const awayScore = matchBase.awayScore || '0';

        // 收集视频
        const videos = [];

        // 官方回放
        const liveInfo = matchBase.liveInfo || {};
        if (liveInfo.replayNoteId) {
            videos.push('官方全场回放$' + liveInfo.replayNoteId);
        }

        // reportList
        const reportList = matchInfo.reportList || [];
        for (let i = 0; i < reportList.length; i++) {
            const item = reportList[i];
            if (item.noteId && item.type === 'video') {
                videos.push((item.title || '战报' + (i + 1)) + '$' + item.noteId);
            }
        }

        // highList
        const highList = matchInfo.highList || [];
        for (let i = 0; i < highList.length; i++) {
            const item = highList[i];
            if (item.noteId && item.type === 'video') {
                videos.push((item.title || '高光' + (i + 1)) + '$' + item.noteId);
            }
        }

        // 如果没有视频，添加测试视频
        if (videos.length === 0) {
            videos.push('暂无视频$https://www.baidu.com');
        }

        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: homeTeam + ' vs ' + awayTeam,
                vod_pic: matchBase.homeTeamLogo || '',
                vod_remarks: matchBase.statusDesc || '',
                vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam + '\n' +
                            '比赛时间: ' + (matchBase.matchTime || '') + '\n' +
                            '场地: ' + (matchBase.venue || '') + '\n' +
                            '阶段: ' + (matchBase.roundStage || '') + '\n' +
                            'reportList数量: ' + reportList.length + '\n' +
                            'highList数量: ' + highList.length,
                vod_play_from: '小红书',
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
