const streamerName = document.getElementById("streamerName");
const streamerStatus = document.getElementById("streamerStatus");
const addStreamer = document.getElementById("addStreamer");
const streamerList = document.getElementById("streamerList");
const streamerSelect = document.getElementById("streamerSelect");

let streamers = getStreamers();

const onlineButton = document.getElementById("onlineButton");
const awayButton = document.getElementById("awayButton");

const offlineButton = document.getElementById("offlineButton");



function loadStreamerDropdown() {

    streamerSelect.innerHTML = "";

    streamers.forEach((streamer, index) => {

        const option = document.createElement("option");

        option.value = index;
        option.textContent = streamer.name;

        streamerSelect.appendChild(option);

    });

}






function displayStreamers() {

    

    streamerList.replaceChildren();

    streamers.forEach((streamer, index) => {

        const div = document.createElement("div");

        div.innerHTML = `
            <strong>${streamer.name}</strong>
            <p>Status: ${streamer.status}</p>
        `;

        streamerList.appendChild(div);

    });

}

onlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "online";
    saveStreamers(streamers);
    displayStreamers();
});


awayButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "away";
    saveStreamers(streamers);
    displayStreamers();
});


offlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "offline";
    saveStreamers(streamers);
    displayStreamers();
});

addStreamer.addEventListener("click", function() {

    const newStreamer = {
        name: streamerName.value,
        status: streamerStatus.value
    };


    streamers.push(newStreamer);


  saveStreamers(streamers);

    displayStreamers();


    streamerName.value = "";

});


displayStreamers();
loadStreamerDropdown();