// test_spider.js - 最简单的 TVBOX JS 测试插件
var rule = {
    title: '测试源',
    host: 'https://www.baidu.com',
    url: '',
    searchUrl: '',
    searchable: 0,
    quickSearch: 0,
    filterable: 0,
    
    // 首页内容
    homeContent: function(filter) {
        return {
            class: [
                {type_id: '1', type_name: '测试分类1'},
                {type_id: '2', type_name: '测试分类2'}
            ],
            list: [
                {
                    vod_id: '1',
                    vod_name: '测试视频1',
                    vod_pic: '',
                    vod_remarks: 'HD',
                    vod_content: '测试内容'
                }
            ]
        };
    },
    
    // 分类内容
    categoryContent: function(tid, pg, filter, extend) {
        return this.homeContent(filter);
    },
    
    // 详情内容
    detailContent: function(ids) {
        return {
            list: [{
                vod_id: ids[0],
                vod_name: '测试视频',
                vod_pic: '',
                vod_remarks: 'HD',
                vod_content: '测试详情',
                vod_play_from: '测试源',
                vod_play_url: '测试$https://www.baidu.com'
            }]
        };
    },
    
    // 搜索
    searchContent: function(key, quick) {
        return {list: []};
    },
    
    // 播放
    playerContent: function(flag, id, vipFlags) {
        return {
            parse: 0,
            url: id
        };
    }
};
