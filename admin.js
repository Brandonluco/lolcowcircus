const streamerName = document.getElementById("streamerName");
const streamerPlatform = document.getElementById("streamerPlatform");
const streamerChannel = document.getElementById("streamerChannel");
const streamerStatus = document.getElementById("streamerStatus");
const addStreamer = document.getElementById("addStreamer");
const streamerList = document.getElementById("streamerList");
const streamerSelect = document.getElementById("streamerSelect");
const alertMessage = document.getElementById("alertMessage");
const alertType = document.getElementById("alertType");
const updateAlert = document.getElementById("updateAlert");
const clearAlert = document.getElementById("clearAlert");
const currentAlert = document.getElementById("currentAlert");

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

function displayCurrentAlert() {

    const alert = getAlert();

    if (!alert) {
        currentAlert.textContent = "No active alert";
        currentAlert.style.backgroundColor = "#adadad";
        currentAlert.style.color = "black";
        return;
    }

    currentAlert.textContent = alert.message;

    if (alert.type === "news") {
        currentAlert.style.backgroundColor = "#2ecc71";
    }

    if (alert.type === "maintenance") {
        currentAlert.style.backgroundColor = "#e74c3c";
    }

    currentAlert.style.color = "white";

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
    platform: streamerPlatform.value,
    channel: streamerChannel.value,
    status: streamerStatus.value
};


    streamers.push(newStreamer);


  saveStreamers(streamers);

    displayStreamers();


    streamerName.value = "";
    streamerPlatform.value = "";
    streamerChannel.value = "";

});

updateAlert.addEventListener("click", function() {

    const newAlert = {
        type: alertType.value,
        message: alertMessage.value
    };

    saveAlert(newAlert);

    alertMessage.value = "";

});

clearAlert.addEventListener("click", function() {

    localStorage.removeItem("alert");

});


displayStreamers();
loadStreamerDropdown();
displayCurrentAlert();