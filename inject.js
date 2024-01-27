var clicked = false 
var orders = []

let btn = document.querySelector('.auctions-search__find')
btn.addEventListener('click', ()=> clicked = true)

var observer = new PerformanceObserver((list)=> {
    list.getEntries().forEach(async (el)=> {
        if (!clicked) return
        if (!el.name.startsWith('https://api.warframe.market/v1/auctions/search?')) return
        clicked = false
        let res = await fetch(el.name)
        let data = await res.json()
        orders = data.payload.auctions
        console.log(orders)
    })
})

function convertDate(datetime) {
    let theevent = new Date(datetime)
    now = new Date()
    let sec_num = (now - theevent) / 1000
    let days    = Math.floor(sec_num / (3600 * 24))
    let hours   = Math.floor((sec_num - (days * (3600 * 24)))/3600)
    let minutes = Math.floor((sec_num - (days * (3600 * 24)) - (hours * 3600)) / 60)
    let seconds = Math.floor(sec_num - (days * (3600 * 24)) - (hours * 3600) - (minutes * 60))
    if (days > 0) return days+' д. назад'
    else if (hours > 0) return hours+' ч. назад'
    else if (minutes > 0) return minutes+' мин. назад'
    else if (seconds > 0) return seconds+' сек. назад'
}

observer.observe({entryTypes: ['resource']})

setInterval(()=> {
    let elements = document.querySelectorAll('.auction-entry')
    elements.forEach((el)=> {
        if (el.querySelector('.added')) {
            if (el.querySelector('.added .attribute-value').textContent != '?') return
        }
        let user = (el.classList.contains('own')) ? document.querySelector('.nickname--sKj0R').textContent : el.querySelector('.user__name--xF_ju').textContent
        let mode = el.querySelector('.link span').textContent.split(' ')[1]

        if (el.querySelector('.added')) {
            orders.forEach((order)=> {
                if (order.item.name == mode && order.owner.ingame_name == user) el.querySelector('.added .attribute-value').textContent = convertDate(order.updated)
            })
        } else {
            let attr = document.createElement('li')
            attr.classList.add('added')
            let span = document.createElement('span')
            span.classList.add('attribute-name')
            span.textContent = 'Обновлен:'
            let b = document.createElement('b')
            b.classList.add('attribute-value')
            orders.forEach((order)=> {
                if (order.item.name == mode && order.owner.ingame_name == user) b.textContent = convertDate(order.updated)
            })
            if (b.textContent == '') b.textContent = '?'
            attr.append(span)
            attr.append(b)
            if (el.querySelector('.auction-entry__mod-attributes')) el.querySelector('.auction-entry__mod-attributes').prepend(attr)
        }
    })
}, 1000)