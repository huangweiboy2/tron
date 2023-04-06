[EN](README.md)  
[简体中文](README_CN.md)  
# This Service base on Tron TRC20

## Project explantion
AT the beginning of this project,we designed it to support multi merchant's use.  
You can change it to signal merchant's use then it will cost fewer fee every transaction.  
Contact me ：[https://t.me/AutoUSDT2TRX0](https://t.me/AutoUSDT2TRX0)  
Programing Langurage：nodejs,Support system: win/linux/macos  
  
## Compile
```js
npm run pkg
```
  
![image](https://user-images.githubusercontent.com/129872486/229836409-2855f307-235c-4128-b504-404777bcd961.png)
![image](https://user-images.githubusercontent.com/129872486/229836665-8ab0a7bd-9cd9-4d46-9c1c-03c57526ca6a.png)
![image](https://user-images.githubusercontent.com/129872486/229836778-0b46368a-da93-46f0-af75-a32364a0d09c.png)
![image](https://user-images.githubusercontent.com/129872486/229836895-0a6788c2-bd45-4687-95c2-b6475b7aabf3.png)

## Functions
```js
Generate new wallet address
USDT TRC20 Transfer monitoring and notification
Auto USDT collection(from new address to collect address)
Manual USDT collection
Collection result notify
```
## Transaction process
```js
Customer order your product -> Generate one new wallet address for this customer -> Wait customer send USDT to this new address -> This system received new payment then notify the set url and begain collect USDT from this new address -> Check if the amount right -> Finish transation

Every time new order happen,one new wallet generated,whic bind with this customer.  
Once a transaction complete,the new address will be delete to protecting customer privacy.Implement anonymous transactions.  
Then as we all know,USDT is Globalized.It solve the problem of transation in different country.
```
Auto USDT collection will take 3-4 minutes to wait result then notify to the set url.

## Auto USDT Collection Service
---
- You can set the target wallet addres to collect USDT from the new address you generated.
- With precise algorithms to calculate energy and netwidth,ensure transation success.
- When auto service failed,there has privatekey to collect USDT by self,ensure the security of funds.
- Auto transfer rest TRX to collection adderss.
- Auto Swap USDT to TRX to replenish TRX's consumption.

## Support me
![欧易_1680753701856](https://user-images.githubusercontent.com/129872486/230269179-73009271-2893-4f5b-a621-92ee2e77a21a.jpg)
TRGefN4fZXTwSLPV2Fm69ESKrsHS2KbqVs
