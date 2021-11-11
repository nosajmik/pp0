onmessage = function (event) {
    postMessage(`${event.data} bit received from main receiver thread`);
};