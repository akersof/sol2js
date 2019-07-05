pragma solidity ^0.5.8;

import "./Deployable.sol";

contract test2 is Deployable{
    uint public counter = 1337;
    function test() public view returns(uint){
        //uint counter = 1;
        return counter;
    }
}

contract
