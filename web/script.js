function main() {
    const TYPES = {
        r: 'red',
        b: 'blue',
        n: 'neutral',
        k: 'killer'
    };
    let gameKey = location.search.substr(1).split("=")[1].split(",");
    
    document.querySelectorAll("img").forEach((pic,i) => {
        if( TYPES[gameKey[i]] )
            pic.src = "./imgs/roles/" + TYPES[gameKey[i]] + ".jpg"
        else
            pic.src = "./imgs/" + gameKey[i] + ".png";
    })
    
}
window.onload = main;